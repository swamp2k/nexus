import { useEffect, useMemo, useRef, useState } from "react";

type GarminImport = {
  id: string;
  filename: string;
  sizeBytes: number | null;
  contentType: string | null;
  status: "uploaded" | "inventorying" | "ready" | "processing" | "complete" | "failed";
  fileCount: number | null;
  detectedFrom: string | null;
  detectedTo: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

type GarminImportFile = { path: string; sizeBytes: number | null; fileType: string | null; status: string };
type StartUploadResponse = { importId: string; uploadId: string; partSize: number; partCount: number };
type UploadedPart = { partNumber: number; etag: string };
type CompleteUploadResponse = { ok: true; import: GarminImport };
type InventoryResponse = { ok: true; importId: string; status: "ready"; fileCount: number; detectedFrom: string | null; detectedTo: string | null };
type ProcessResponse = { ok: true; processed: number; failed: number; remaining: boolean; completed: boolean };
type GarminOverview = {
  daily: Record<string, unknown> | null;
  sleep: Record<string, unknown> | null;
  rhr: Record<string, unknown> | null;
  activities: Array<Record<string, unknown>>;
  counts: { dailyCount?: number; sleepCount?: number; activityCount?: number } | null;
};

type UploadState = "idle" | "uploading" | "complete" | "error";
type FilesState = "idle" | "loading" | "ready" | "error";

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

function formatDate(value: string): string {
  try { return new Intl.DateTimeFormat("da-DK", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
  catch { return value; }
}

function hours(seconds: unknown): string {
  const value = typeof seconds === "number" ? seconds : Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return "—";
  const h = Math.floor(value / 3600);
  const m = Math.round((value % 3600) / 60);
  return `${h} t ${m} min`;
}

function numberValue(row: Record<string, unknown> | null, key: string): number | null {
  const value = row?.[key];
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function responseError(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: string; detail?: string };
    return body.detail ?? body.error ?? `HTTP ${response.status}`;
  } catch { return `HTTP ${response.status}`; }
}

export default function GarminPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [imports, setImports] = useState<GarminImport[]>([]);
  const [importsState, setImportsState] = useState<"loading" | "ready" | "error">("loading");
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [progress, setProgress] = useState(0);
  const [uploadFilename, setUploadFilename] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [inventoryingId, setInventoryingId] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [processedFiles, setProcessedFiles] = useState(0);
  const [selectedImportId, setSelectedImportId] = useState<string | null>(null);
  const [inventoryFiles, setInventoryFiles] = useState<GarminImportFile[]>([]);
  const [filesState, setFilesState] = useState<FilesState>("idle");
  const [filesError, setFilesError] = useState<string | null>(null);
  const [overview, setOverview] = useState<GarminOverview | null>(null);

  const selectedImport = imports.find((item) => item.id === selectedImportId) ?? null;
  const fileTypeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const file of inventoryFiles) {
      const type = file.fileType?.toLowerCase() || "uden filtype";
      counts.set(type, (counts.get(type) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [inventoryFiles]);

  async function refreshOverview() {
    try {
      const response = await fetch("/api/garmin/overview", { credentials: "same-origin", cache: "no-store" });
      if (response.ok) setOverview(await response.json() as GarminOverview);
    } catch { /* overview is optional until first import */ }
  }

  async function refreshImports() {
    try {
      const response = await fetch("/api/garmin/imports", { credentials: "same-origin" });
      if (!response.ok) throw new Error(await responseError(response));
      const body = await response.json() as { imports: GarminImport[] };
      setImports(body.imports);
      setImportsState("ready");
    } catch { setImportsState("error"); }
  }

  useEffect(() => { void refreshImports(); void refreshOverview(); }, []);

  async function loadInventoryFiles(importId: string) {
    if (selectedImportId === importId && filesState !== "error") {
      setSelectedImportId(null); setInventoryFiles([]); setFilesState("idle"); return;
    }
    setSelectedImportId(importId); setInventoryFiles([]); setFilesError(null); setFilesState("loading");
    try {
      const response = await fetch(`/api/garmin/imports/files?${new URLSearchParams({ importId })}`, { credentials: "same-origin" });
      if (!response.ok) throw new Error(await responseError(response));
      setInventoryFiles((await response.json() as { files: GarminImportFile[] }).files);
      setFilesState("ready");
    } catch (error) {
      setFilesError(error instanceof Error ? error.message : "inventory_files_failed"); setFilesState("error");
    }
  }

  async function inventoryImport(importId: string) {
    setInventoryingId(importId);
    setImports((current) => current.map((item) => item.id === importId ? { ...item, status: "inventorying", errorMessage: null } : item));
    try {
      const response = await fetch(`/api/garmin/imports/inventory?${new URLSearchParams({ importId })}`, { method: "POST", credentials: "same-origin" });
      if (!response.ok) throw new Error(await responseError(response));
      const result = await response.json() as InventoryResponse;
      setImports((current) => current.map((item) => item.id === importId ? {
        ...item, status: "ready", fileCount: result.fileCount, detectedFrom: result.detectedFrom,
        detectedTo: result.detectedTo, errorMessage: null, updatedAt: new Date().toISOString(),
      } : item));
    } catch (error) {
      const message = error instanceof Error ? error.message : "inventory_failed";
      setImports((current) => current.map((item) => item.id === importId ? { ...item, status: "failed", errorMessage: message } : item));
    } finally { setInventoryingId(null); void refreshImports(); }
  }

  async function processImport(importId: string) {
    setProcessingId(importId); setProcessedFiles(0);
    setImports((current) => current.map((item) => item.id === importId ? { ...item, status: "processing", errorMessage: null } : item));
    try {
      let remaining = true;
      while (remaining) {
        const response = await fetch(`/api/garmin/imports/process?${new URLSearchParams({ importId })}`, { method: "POST", credentials: "same-origin" });
        if (!response.ok) throw new Error(await responseError(response));
        const result = await response.json() as ProcessResponse;
        setProcessedFiles((current) => current + result.processed + result.failed);
        remaining = result.remaining;
      }
      await Promise.all([refreshImports(), refreshOverview()]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "garmin_processing_failed";
      setImports((current) => current.map((item) => item.id === importId ? { ...item, status: "failed", errorMessage: message } : item));
    } finally { setProcessingId(null); }
  }

  async function uploadFile(file: File) {
    setUploadState("uploading"); setUploadFilename(file.name); setUploadError(null); setProgress(0);
    let importId: string | null = null;
    let uploadId: string | null = null;
    try {
      const startResponse = await fetch("/api/garmin/uploads/start", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, size: file.size, contentType: file.type || "application/octet-stream" }),
      });
      if (!startResponse.ok) throw new Error(await responseError(startResponse));
      const start = await startResponse.json() as StartUploadResponse;
      importId = start.importId; uploadId = start.uploadId;
      const parts: UploadedPart[] = [];
      for (let index = 0; index < start.partCount; index += 1) {
        const partNumber = index + 1;
        const offset = index * start.partSize;
        const query = new URLSearchParams({ importId: start.importId, uploadId: start.uploadId, partNumber: String(partNumber) });
        const partResponse = await fetch(`/api/garmin/uploads/part?${query}`, {
          method: "PUT", credentials: "same-origin", body: file.slice(offset, Math.min(offset + start.partSize, file.size)),
        });
        if (!partResponse.ok) throw new Error(await responseError(partResponse));
        parts.push(await partResponse.json() as UploadedPart);
        setProgress(Math.round((partNumber / start.partCount) * 92));
      }
      const completeResponse = await fetch("/api/garmin/uploads/complete", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ importId: start.importId, uploadId: start.uploadId, filename: file.name, size: file.size, contentType: file.type || "application/octet-stream", parts }),
      });
      if (!completeResponse.ok) throw new Error(await responseError(completeResponse));
      const complete = await completeResponse.json() as CompleteUploadResponse;
      setImports((current) => [complete.import, ...current.filter((item) => item.id !== complete.import.id)]);
      setProgress(100); setUploadState("complete");
      await inventoryImport(complete.import.id);
    } catch (error) {
      if (importId && uploadId) {
        await fetch(`/api/garmin/uploads?${new URLSearchParams({ importId, uploadId })}`, { method: "DELETE", credentials: "same-origin" }).catch(() => undefined);
      }
      setUploadError(error instanceof Error ? error.message : "upload_failed"); setUploadState("error");
    } finally { if (inputRef.current) inputRef.current.value = ""; }
  }

  const daily = overview?.daily ?? null;
  const sleep = overview?.sleep ?? null;
  const latestRhr = numberValue(overview?.rhr ?? null, "resting_hr") ?? numberValue(daily, "resting_hr");

  return (
    <section className="garmin-page" aria-labelledby="garmin-heading">
      <div className="module-page-hero">
        <div className="module-page-icon tone-blue">⌖</div>
        <div><p className="section-label">Sundhed</p><h2 id="garmin-heading">Garmin</h2><p>GarminDB-data normaliseret i Nexus, mens de originale JSON- og FIT-filer bevares råt.</p></div>
      </div>

      {daily && (
        <section className="garmin-health-overview">
          <div className="garmin-health-heading"><div><p className="section-label">Seneste data</p><h3>{String(daily.date ?? "")}</h3></div><span>{overview?.counts?.dailyCount ?? 0} dage · {overview?.counts?.activityCount ?? 0} aktiviteter</span></div>
          <div className="garmin-metric-grid">
            <article><span>Steps</span><strong>{numberValue(daily, "steps")?.toLocaleString("da-DK") ?? "—"}</strong><small>Mål {numberValue(daily, "step_goal")?.toLocaleString("da-DK") ?? "—"}</small></article>
            <article><span>Hvilepuls</span><strong>{latestRhr === null ? "—" : `${Math.round(latestRhr)} bpm`}</strong><small>{numberValue(daily, "min_hr") ?? "—"}–{numberValue(daily, "max_hr") ?? "—"} bpm</small></article>
            <article><span>Body Battery</span><strong>{numberValue(daily, "body_battery_latest") ?? "—"}</strong><small>{numberValue(daily, "body_battery_low") ?? "—"} → {numberValue(daily, "body_battery_high") ?? "—"}</small></article>
            <article><span>Stress</span><strong>{numberValue(daily, "avg_stress") ?? "—"}</strong><small>Maks {numberValue(daily, "max_stress") ?? "—"}</small></article>
            <article><span>Søvn</span><strong>{hours(sleep?.sleep_seconds)}</strong><small>Dyb {hours(sleep?.deep_seconds)} · REM {hours(sleep?.rem_seconds)}</small></article>
            <article><span>Aktive kalorier</span><strong>{numberValue(daily, "active_calories") === null ? "—" : `${Math.round(numberValue(daily, "active_calories")!)} kcal`}</strong><small>Total {Math.round(numberValue(daily, "total_calories") ?? 0)} kcal</small></article>
          </div>

          {overview && overview.activities.length > 0 && (
            <div className="garmin-recent-activities"><p className="section-label">Seneste aktiviteter</p>{overview.activities.map((activity) => (
              <div key={String(activity.activity_id)}><div><strong>{String(activity.name ?? activity.type ?? "Aktivitet")}</strong><span>{String(activity.start_time_local ?? activity.start_time_gmt ?? "")}</span></div><span>{numberValue(activity, "distance_m") === null ? "" : `${(numberValue(activity, "distance_m")! / 1000).toFixed(1)} km`}</span><span>{hours(activity.duration_seconds)}</span></div>
            ))}</div>
          )}
        </section>
      )}

      <div className="garmin-summary-grid">
        <article className="summary-card"><span className="summary-kicker">Status</span><strong>{overview?.counts?.dailyCount ? `${overview.counts.dailyCount} dage importeret` : "Klar til GarminDB"}</strong><p>Normaliserede health-data ligger pr. Nexus-bruger i D1.</p></article>
        <article className="summary-card"><span className="summary-kicker">Rådata</span><strong>Bevares uændret</strong><p>ZIP, JSON og FIT forbliver i R2 og kan genbehandles senere.</p></article>
        <article className="summary-card"><span className="summary-kicker">Pipeline</span><strong>Batch-baseret</strong><p>Daily, sleep, RHR, weight og activities parses i små stabile Worker-batches.</p></article>
      </div>

      <article className="import-card">
        <div><p className="section-label">Import</p><h3>Upload GarminDB ZIP</h3><p>Pak GarminDB-outputtet som ZIP og upload det her. Nexus inventerer først og importerer derefter de understøttede JSON-filer.</p></div>
        <input ref={inputRef} className="visually-hidden" type="file" accept=".zip,application/zip" disabled={uploadState === "uploading"} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadFile(file); }} />
        <button className="primary-action" type="button" disabled={uploadState === "uploading"} onClick={() => inputRef.current?.click()}>{uploadState === "uploading" ? `Uploader ${progress}%` : "Upload GarminDB ZIP"}</button>
        {uploadState === "uploading" && <div className="upload-progress" aria-label={`Upload ${progress}%`}><span style={{ width: `${progress}%` }} /></div>}
        {uploadState === "complete" && <p className="import-feedback success">{uploadFilename} er uploadet og analyseret. Tryk “Importér data” nedenfor.</p>}
        {uploadState === "error" && <p className="import-feedback error">Upload fejlede: {uploadError}</p>}
      </article>

      <section className="imports-section" aria-labelledby="imports-heading">
        <div className="imports-heading"><div><p className="section-label">Historik</p><h3 id="imports-heading">Garmin-imports</h3></div><button className="secondary-action" type="button" onClick={() => void refreshImports()}>Opdatér</button></div>
        {importsState === "loading" && <p className="empty-state">Henter importhistorik…</p>}
        {importsState === "error" && <p className="empty-state">Importhistorikken kunne ikke hentes.</p>}
        {importsState === "ready" && imports.length === 0 && <p className="empty-state">Ingen imports endnu.</p>}
        {imports.length > 0 && <div className="imports-list">{imports.map((item) => (
          <article className="import-row" key={item.id}>
            <div className="import-file-icon">ZIP</div>
            <div className="import-row-copy"><strong>{item.filename}</strong><span>{formatBytes(item.sizeBytes)} · {formatDate(item.createdAt)}{item.fileCount !== null ? ` · ${item.fileCount} filer` : ""}{item.detectedFrom && item.detectedTo ? ` · ${item.detectedFrom} → ${item.detectedTo}` : ""}</span>{processingId === item.id && <span>Parser batch… {processedFiles} filer behandlet</span>}{item.errorMessage && <span className="import-row-error">{item.errorMessage}</span>}</div>
            <div className="import-row-actions">
              {(item.status === "uploaded" || item.status === "failed") && <button className="secondary-action" type="button" disabled={inventoryingId === item.id} onClick={() => void inventoryImport(item.id)}>{inventoryingId === item.id ? "Analyserer…" : "Analysér"}</button>}
              {(item.status === "ready" || item.status === "processing") && <button className="primary-action" type="button" disabled={processingId !== null} onClick={() => void processImport(item.id)}>{processingId === item.id ? `Importerer… ${processedFiles}` : "Importér data"}</button>}
              {(item.status === "ready" || item.status === "complete") && <button className="secondary-action" type="button" onClick={() => void loadInventoryFiles(item.id)}>{selectedImportId === item.id ? "Skjul filer" : "Se filer"}</button>}
              <span className={`import-status status-${item.status}`}>{item.status}</span>
            </div>
          </article>
        ))}</div>}

        {selectedImport && <section className="inventory-panel" aria-labelledby="inventory-heading">
          <div className="inventory-heading"><div><span className="summary-kicker">Inventory</span><h4 id="inventory-heading">{selectedImport.filename}</h4></div><span className="inventory-total">{inventoryFiles.length || selectedImport.fileCount || 0} filer</span></div>
          {filesState === "loading" && <p className="empty-state">Henter filoversigt…</p>}
          {filesState === "error" && <p className="import-feedback error">Filoversigten kunne ikke hentes: {filesError}</p>}
          {filesState === "ready" && <><div className="inventory-type-grid">{fileTypeCounts.map(([type, count]) => <div className="inventory-type-card" key={type}><strong>{count}</strong><span>.{type === "uden filtype" ? "—" : type}</span></div>)}</div><div className="inventory-file-list">{inventoryFiles.map((file) => <div className="inventory-file-row" key={file.path}><span className="inventory-file-type">{file.fileType?.toUpperCase() || "FILE"}</span><code title={file.path}>{file.path}</code><span>{file.status}</span><span>{formatBytes(file.sizeBytes)}</span></div>)}</div></>}
        </section>}
      </section>
    </section>
  );
}
