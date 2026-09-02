import { useEffect, useState } from "react";

type ServerResponse = {
  configured: boolean;
  server: { label: string; url: string; verifiedAt: string | null; updatedAt: string } | null;
};

type State = "loading" | "idle" | "saving" | "saved" | "testing" | "error";

function messageFor(error: string): string {
  if (error === "unraid_invalid_api_key") return "API-nøglen blev afvist af Unraid.";
  if (error === "unraid_unreachable") return "Nexus kunne ikke nå Unraid-serveren fra Cloudflare.";
  if (error === "unraid_credentials_key_not_configured") return "Krypteringsnøglen til Unraid er ikke konfigureret.";
  return error;
}

export default function UnraidSettings() {
  const [configured, setConfigured] = useState(false);
  const [label, setLabel] = useState("Tower");
  const [url, setUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [verifiedAt, setVerifiedAt] = useState<string | null>(null);
  const [state, setState] = useState<State>("loading");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const response = await fetch("/api/unraid/server", { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json() as ServerResponse;
      setConfigured(body.configured);
      if (body.server) { setLabel(body.server.label); setUrl(body.server.url); setVerifiedAt(body.server.verifiedAt); }
      setState("idle");
    } catch { setState("error"); setError("Unraid-indstillinger kunne ikke hentes."); }
  }

  useEffect(() => { void load(); }, []);

  async function save() {
    if (!url.trim() || !apiKey.trim()) { setError("URL og API-nøgle skal udfyldes."); return; }
    setState("saving"); setError(null);
    try {
      const response = await fetch("/api/unraid/server", {
        method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, url, apiKey }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string; server?: ServerResponse["server"] };
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      setConfigured(true); setApiKey(""); setVerifiedAt(body.server?.verifiedAt ?? new Date().toISOString()); setState("saved");
    } catch (cause) { setState("error"); setError(messageFor(cause instanceof Error ? cause.message : "save_failed")); }
  }

  async function test() {
    setState("testing"); setError(null);
    try {
      const response = await fetch("/api/unraid/test", { method: "POST", credentials: "same-origin" });
      const body = await response.json().catch(() => ({})) as { error?: string; verifiedAt?: string };
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      setVerifiedAt(body.verifiedAt ?? new Date().toISOString()); setState("saved");
    } catch (cause) { setState("error"); setError(messageFor(cause instanceof Error ? cause.message : "test_failed")); }
  }

  async function remove() {
    if (!confirm("Fjern Unraid-forbindelsen fra Nexus?")) return;
    await fetch("/api/unraid/server", { method: "DELETE", credentials: "same-origin" });
    setConfigured(false); setUrl(""); setApiKey(""); setVerifiedAt(null); setState("idle");
  }

  if (state === "loading") return <p className="settings-loading">Henter Unraid-indstillinger…</p>;

  return <div className="settings-form">
    <p className="settings-help">Nexus bruger Unraid 7.2+ GraphQL API. API-nøglen krypteres i D1 og sendes aldrig tilbage til browseren.</p>
    <label><span>Navn</span><input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Tower" /></label>
    <label><span>Unraid URL</span><input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://unraid.example.com" autoCapitalize="none" autoCorrect="off" /></label>
    <label><span>{configured ? "Ny API-nøgle · kun ved ændring" : "API-nøgle"}</span><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="new-password" placeholder={configured ? "Lad stå tom for at beholde eksisterende" : "Unraid API key"} /></label>
    {verifiedAt && <p className="settings-feedback success">Forbindelse bekræftet {new Date(verifiedAt).toLocaleString("da-DK")}.</p>}
    {error && <p className="settings-feedback error">{error}</p>}
    <div className="settings-location-actions">
      <button className="primary-action" type="button" disabled={state === "saving" || !url.trim() || !apiKey.trim()} onClick={() => void save()}>{state === "saving" ? "Gemmer…" : configured ? "Gem ny forbindelse" : "Gem og test"}</button>
      {configured && <button className="secondary-action" type="button" disabled={state === "testing"} onClick={() => void test()}>{state === "testing" ? "Tester…" : "Test forbindelse"}</button>}
      {configured && <button className="secondary-action" type="button" onClick={() => void remove()}>Fjern</button>}
    </div>
  </div>;
}
