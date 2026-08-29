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

async function responseError(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: string; detail?: string };
    return body.detail ?? body.error ?? `HTTP ${response.status}`;
  } catch { return `HTTP ${response.status}`; }
}

export default function GarminImportSettings() {
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

  const selectedImport = imports.find((item) => item.id === selectedImportId) ?? null;
  const fileTypeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const file of inventoryFiles) {
      const type = file.fileType?.toLowerCase() || "uden filtype";
      counts.set(type, (counts.get(type) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [inventoryFiles]);

  async function refreshImports() {
    try {
      const response = await fetch("/api/garmin/imports", { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error(await responseError(response));
      const body = await response.json() as { imports: GarminImport[] };
      setImports(body.imports);
      setImportsState("ready");
    } catch { setImportsState("error"); }
  }

  useEffect(() => { void refreshImports(); }, []);

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
    try {
      const response = await fetch(`/api/garmin/imports/inventory?${new URLSearchParams({ importId })}`, { method: "POST", credentials: "same-origin" });
      if (!response.ok) throw new Error(await responseError(response));
      await response.json() as InventoryResponse;
      await refreshImports();
    } finally { setInventoryingId(null); }
  }

  async function processImport(importId: string) {
    setProcessingId(importId); setProcessedFiles(0);
    try {
      let remaining = true;
      while (remaining) {
        const response = await fetch(`/api/garmin/imports/process?${new URLSearchParams({ importId })}`, { method: "POST", credentials: "same-origin" });
        if (!response.ok) throw new Error(await responseError(response));
        const result = await response.json() as ProcessResponse;
        setProcessedFiles((current) => current + result.processed + result.failed);
        remaining = result.remaining;
      }
      await refreshImports();
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "garmin_processing_failed");
      await refreshImports();
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
      setProgress(100); setUploadState("complete");
      await inventoryImport(complete.import.id);
    } catch (error) {
      if (importId && uploadId) {
        await fetch(`/api/garmin/uploads?${new URLSearchParams({ importId, uploadId })}`, { method: "DELETE", credentials: "same-origin" }).catch(() => undefined);
      }
      setUploadError(error instanceof Error ? error.message : "upload_failed"); setUploadState("error");
    } finally { if (inputRef.current) inputRef.current.value = ""; }
  }

  return (
    <article className="settings-card">
      <div className="settings-card-heading">
        <div><p className="section-label">Datakilde</p><h2>Garmin</h2><p>Import og vedligeholdelse af GarminDB-data. Den almindelige Garmin-side viser kun de normaliserede sundhedsdata.</p></div>
        <span className="settings-icon" aria-hidden="true">⌖</span>
      </div>

      <div className="settings-form garmin-settings-form">
        <input ref={inputRef} className="visually-hidden" type="file" accept=".zip,application/zip" disabled={uploadState === "uploading"} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadFile(file); }} />
        <div className="settings-location-actions">
          <button className="primary-action" type="button" disabled={uploadState === "uploading"} onClick={() => inputRef.current?.click()}>{uploadState === "uploading" ? `Uploader ${progress}%` : "Upload GarminDB ZIP"}</button>
          <span>Rå ZIP, JSON og FIT bevares i R2.</span>
        </div>
        {uploadState === "uploading" && <div className="upload-progress" aria-label={`Upload ${progress}%`}><span style={{ width: `${progress}%` }} /></div>}
        {uploadState === "complete" && <p className="settings-feedback success">{uploadFilename} er uploadet og inventeret.</p>}
        {uploadError && <p className="settings-feedback error">{uploadError}</p>}

        <div className="garmin-settings-history">
          <div className="imports-heading"><div><p className="section-label">Historik</p><h3>Garmin-imports</h3></div><button className="secondary-action" type="button" onClick={() => void refreshImports()}>Opdatér</button></div>
          {importsState === "loading" && <p className="empty-state">Henter importhistorik…</p>}
          {importsState === "error" && <p className="empty-state">Importhistorikken kunne ikke hentes.</p>}
          {importsState === "ready" && imports.length === 0 && <p className="empty-state">Ingen Garmin-imports endnu.</p>}
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

          {selectedImport && <section className="inventory-panel" aria-labelledby="settings-inventory-heading">
            <div className="inventory-heading"><div><span className="summary-kicker">Inventory</span><h4 id="settings-inventory-heading">{selectedImport.filename}</h4></div><span className="inventory-total">{inventoryFiles.length || selectedImport.fileCount || 0} filer</span></div>
            {filesState === "loading" && <p className="empty-state">Henter filoversigt…</p>}
            {filesState === "error" && <p className="settings-feedback error">Filoversigten kunne ikke hentes: {filesError}</p>}
            {filesState === "ready" && <><div className="inventory-type-grid">{fileTypeCounts.map(([type, count]) => <div className="inventory-type-card" key={type}><strong>{count}</strong><span>.{type === "uden filtype" ? "—" : type}</span></div>)}</div><div className="inventory-file-list">{inventoryFiles.map((file) => <div className="inventory-file-row" key={file.path}><span className="inventory-file-type">{file.fileType?.toUpperCase() || "FILE"}</span><code title={file.path}>{file.path}</code><span>{file.status}</span><span>{formatBytes(file.sizeBytes)}</span></div>)}</div></>}
          </section>}
        </div>
      </div>
    </article>
  );
}
