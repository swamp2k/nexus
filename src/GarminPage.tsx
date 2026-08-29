import { useEffect, useRef, useState } from "react";

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

type StartUploadResponse = {
  importId: string;
  uploadId: string;
  partSize: number;
  partCount: number;
};

type UploadedPart = {
  partNumber: number;
  etag: string;
};

type CompleteUploadResponse = {
  ok: true;
  import: GarminImport;
};

type InventoryResponse = {
  ok: true;
  importId: string;
  status: "ready";
  fileCount: number;
  detectedFrom: string | null;
  detectedTo: string | null;
};

type UploadState = "idle" | "uploading" | "complete" | "error";

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

function formatDate(value: string): string {
  try {
    return new Intl.DateTimeFormat("da-DK", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

async function responseError(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: string; detail?: string };
    return body.detail ?? body.error ?? `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
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

  async function refreshImports() {
    try {
      const response = await fetch("/api/garmin/imports", { credentials: "same-origin" });
      if (!response.ok) throw new Error(await responseError(response));
      const body = await response.json() as { imports: GarminImport[] };
      setImports(body.imports);
      setImportsState("ready");
    } catch {
      setImportsState("error");
    }
  }

  useEffect(() => {
    void refreshImports();
  }, []);

  async function inventoryImport(importId: string) {
    setInventoryingId(importId);
    setImports((current) => current.map((item) => item.id === importId ? { ...item, status: "inventorying", errorMessage: null } : item));

    try {
      const query = new URLSearchParams({ importId });
      const response = await fetch(`/api/garmin/imports/inventory?${query}`, {
        method: "POST",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error(await responseError(response));
      const result = await response.json() as InventoryResponse;

      setImports((current) => current.map((item) => item.id === importId ? {
        ...item,
        status: "ready",
        fileCount: result.fileCount,
        detectedFrom: result.detectedFrom,
        detectedTo: result.detectedTo,
        errorMessage: null,
        updatedAt: new Date().toISOString(),
      } : item));
    } catch (error) {
      const message = error instanceof Error ? error.message : "inventory_failed";
      setImports((current) => current.map((item) => item.id === importId ? {
        ...item,
        status: "failed",
        errorMessage: message,
      } : item));
    } finally {
      setInventoryingId(null);
      void refreshImports();
    }
  }

  async function uploadFile(file: File) {
    setUploadState("uploading");
    setUploadFilename(file.name);
    setUploadError(null);
    setProgress(0);

    let importId: string | null = null;
    let uploadId: string | null = null;

    try {
      const startResponse = await fetch("/api/garmin/uploads/start", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          size: file.size,
          contentType: file.type || "application/octet-stream",
        }),
      });

      if (!startResponse.ok) throw new Error(await responseError(startResponse));
      const start = await startResponse.json() as StartUploadResponse;
      importId = start.importId;
      uploadId = start.uploadId;

      const parts: UploadedPart[] = [];
      for (let index = 0; index < start.partCount; index += 1) {
        const partNumber = index + 1;
        const offset = index * start.partSize;
        const chunk = file.slice(offset, Math.min(offset + start.partSize, file.size));
        const query = new URLSearchParams({
          importId: start.importId,
          uploadId: start.uploadId,
          partNumber: String(partNumber),
        });

        const partResponse = await fetch(`/api/garmin/uploads/part?${query}`, {
          method: "PUT",
          credentials: "same-origin",
          body: chunk,
        });
        if (!partResponse.ok) throw new Error(await responseError(partResponse));

        parts.push(await partResponse.json() as UploadedPart);
        setProgress(Math.round((partNumber / start.partCount) * 92));
      }

      const completeResponse = await fetch("/api/garmin/uploads/complete", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          importId: start.importId,
          uploadId: start.uploadId,
          filename: file.name,
          size: file.size,
          contentType: file.type || "application/octet-stream",
          parts,
        }),
      });
      if (!completeResponse.ok) throw new Error(await responseError(completeResponse));

      const complete = await completeResponse.json() as CompleteUploadResponse;
      setImports((current) => [complete.import, ...current.filter((item) => item.id !== complete.import.id)]);
      setProgress(100);
      setUploadState("complete");
      await inventoryImport(complete.import.id);
    } catch (error) {
      if (importId && uploadId) {
        const query = new URLSearchParams({ importId, uploadId });
        await fetch(`/api/garmin/uploads?${query}`, {
          method: "DELETE",
          credentials: "same-origin",
        }).catch(() => undefined);
      }
      setUploadError(error instanceof Error ? error.message : "upload_failed");
      setUploadState("error");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <section className="garmin-page" aria-labelledby="garmin-heading">
      <div className="module-page-hero">
        <div className="module-page-icon tone-blue">⌖</div>
        <div>
          <p className="section-label">Første datamodul</p>
          <h2 id="garmin-heading">Garmin</h2>
          <p>Få dine Garmin-data ud af silo'en, behold rådata og gør historikken søgbar, sammenlignelig og klar til analyse.</p>
        </div>
      </div>

      <div className="garmin-summary-grid">
        <article className="summary-card">
          <span className="summary-kicker">Status</span>
          <strong>{imports.length > 0 ? `${imports.length} import${imports.length === 1 ? "" : "er"}` : "Klar til første import"}</strong>
          <p>Rådata gemmes i R2 og importhistorikken følger den enkelte Nexus-bruger.</p>
        </article>
        <article className="summary-card">
          <span className="summary-kicker">Rådata</span>
          <strong>Bevares uændret</strong>
          <p>Originale ZIP, FIT, TCX, GPX og JSON-filer beholdes, så vi altid kan genbehandle dem senere.</p>
        </article>
        <article className="summary-card">
          <span className="summary-kicker">Analyse</span>
          <strong>Inventory først</strong>
          <p>Nexus læser ZIP-metadata direkte fra R2 og bygger parseren efter de datatyper Garmin faktisk leverer.</p>
        </article>
      </div>

      <article className="import-card">
        <div>
          <p className="section-label">Import</p>
          <h3>Upload din Garmin-export</h3>
          <p>Nexus uploader store exports i mindre dele, samler dem direkte i R2 og inventerer derefter ZIP'en uden at hente hele arkivet ind i Worker-memory.</p>
        </div>

        <div className="import-steps">
          <div><span>1</span><p>Hent en komplet Garmin-dataexport.</p></div>
          <div><span>2</span><p>Upload arkivet her. Store filer deles automatisk op.</p></div>
          <div><span>3</span><p>Nexus inventerer ZIP'en og registrerer filtyperne.</p></div>
          <div><span>4</span><p>Derefter bygger vi parser, historik og analyse på de faktiske data.</p></div>
        </div>

        <input
          ref={inputRef}
          className="visually-hidden"
          type="file"
          accept=".zip,.fit,.tcx,.gpx,.json,application/zip"
          disabled={uploadState === "uploading"}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void uploadFile(file);
          }}
        />
        <button
          className="primary-action"
          type="button"
          disabled={uploadState === "uploading"}
          onClick={() => inputRef.current?.click()}
        >
          {uploadState === "uploading" ? `Uploader ${progress}%` : "Importér Garmin-export"}
        </button>

        {uploadState === "uploading" && (
          <div className="upload-progress" aria-label={`Upload ${progress}%`}>
            <span style={{ width: `${progress}%` }} />
          </div>
        )}
        {uploadState === "complete" && <p className="import-feedback success">{uploadFilename} er uploadet. Inventory kører automatisk.</p>}
        {uploadState === "error" && <p className="import-feedback error">Upload fejlede: {uploadError}</p>}
        <small className="import-note">Råfilen gemmes under din bruger i den fælles <code>nexus-data</code> bucket.</small>
      </article>

      <section className="imports-section" aria-labelledby="imports-heading">
        <div className="imports-heading">
          <div>
            <p className="section-label">Historik</p>
            <h3 id="imports-heading">Garmin-imports</h3>
          </div>
          <button className="secondary-action" type="button" onClick={() => void refreshImports()}>Opdatér</button>
        </div>

        {importsState === "loading" && <p className="empty-state">Henter importhistorik…</p>}
        {importsState === "error" && <p className="empty-state">Importhistorikken kunne ikke hentes.</p>}
        {importsState === "ready" && imports.length === 0 && <p className="empty-state">Ingen imports endnu. Den første Garmin-export bliver vores grundlag for parseren.</p>}
        {imports.length > 0 && (
          <div className="imports-list">
            {imports.map((item) => (
              <article className="import-row" key={item.id}>
                <div className="import-file-icon">ZIP</div>
                <div className="import-row-copy">
                  <strong>{item.filename}</strong>
                  <span>
                    {formatBytes(item.sizeBytes)} · {formatDate(item.createdAt)}
                    {item.fileCount !== null ? ` · ${item.fileCount} filer` : ""}
                    {item.detectedFrom && item.detectedTo ? ` · ${item.detectedFrom} → ${item.detectedTo}` : ""}
                  </span>
                  {item.errorMessage && <span className="import-row-error">{item.errorMessage}</span>}
                </div>
                <div className="import-row-actions">
                  {(item.status === "uploaded" || item.status === "failed") && (
                    <button
                      className="secondary-action"
                      type="button"
                      disabled={inventoryingId === item.id}
                      onClick={() => void inventoryImport(item.id)}
                    >
                      {inventoryingId === item.id ? "Analyserer…" : "Analysér"}
                    </button>
                  )}
                  <span className={`import-status status-${item.status}`}>{item.status}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
