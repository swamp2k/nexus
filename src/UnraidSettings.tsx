import { useEffect, useState } from "react";

type IntegrationResponse = {
  configured: boolean;
  integration: { label: string; verifiedAt: string | null; updatedAt: string } | null;
};

type ServerInfo = { label: string; configured: boolean };
type State = "loading" | "idle" | "saving" | "saved" | "testing" | "error";

function messageFor(error: string): string {
  if (error === "unraidwatch_unauthorized") return "Tokenet blev afvist af UnraidWatch. Det kan være tilbagekaldt — opret et nyt under Settings → Integrations.";
  if (error === "unraidwatch_not_connected") return "Nexus har endnu ikke et UnraidWatch-token.";
  if (error === "unraidwatch_server_not_configured") return "UnraidWatch-kontoen har ingen Unraid-server gemt endnu.";
  if (error === "unraidwatch_upstream_unavailable") return "UnraidWatch kunne ikke nå Unraid-serveren.";
  if (error === "unraidwatch_binding_missing") return "Forbindelsen til UnraidWatch er ikke aktiv i denne udrulning.";
  if (error === "unraidwatch_internal") return "UnraidWatch svarede med en intern fejl.";
  if (error === "invalid_integration_token") return "Tokenet ser ikke gyldigt ud.";
  if (error.startsWith("unraid_credentials_key")) return "Krypteringsnøglen til Nexus-integrationer er ikke konfigureret.";
  return error;
}

export default function UnraidSettings() {
  const [configured, setConfigured] = useState(false);
  const [label, setLabel] = useState("UnraidWatch");
  const [token, setToken] = useState("");
  const [verifiedAt, setVerifiedAt] = useState<string | null>(null);
  const [server, setServer] = useState<ServerInfo | null>(null);
  const [state, setState] = useState<State>("loading");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const response = await fetch("/api/unraid/integration", { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json() as IntegrationResponse;
      setConfigured(body.configured);
      if (body.integration) { setLabel(body.integration.label); setVerifiedAt(body.integration.verifiedAt); }
      setState("idle");
    } catch { setState("error"); setError("UnraidWatch-indstillinger kunne ikke hentes."); }
  }

  useEffect(() => { void load(); }, []);

  async function save() {
    if (!configured && !token.trim()) { setError("Indsæt et integrations-token fra UnraidWatch."); return; }
    setState("saving"); setError(null);
    try {
      const response = await fetch("/api/unraid/integration", {
        method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, token }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string; integration?: IntegrationResponse["integration"]; server?: ServerInfo };
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      setConfigured(true); setToken(""); setServer(body.server ?? null);
      setVerifiedAt(body.integration?.verifiedAt ?? new Date().toISOString()); setState("saved");
    } catch (cause) { setState("error"); setError(messageFor(cause instanceof Error ? cause.message : "save_failed")); }
  }

  async function test() {
    setState("testing"); setError(null);
    try {
      const response = await fetch("/api/unraid/test", { method: "POST", credentials: "same-origin" });
      const body = await response.json().catch(() => ({})) as { error?: string; verifiedAt?: string; server?: ServerInfo };
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      setServer(body.server ?? null);
      setVerifiedAt(body.verifiedAt ?? new Date().toISOString()); setState("saved");
    } catch (cause) { setState("error"); setError(messageFor(cause instanceof Error ? cause.message : "test_failed")); }
  }

  async function remove() {
    if (!confirm("Fjern UnraidWatch-forbindelsen fra Nexus?")) return;
    await fetch("/api/unraid/integration", { method: "DELETE", credentials: "same-origin" });
    setConfigured(false); setToken(""); setVerifiedAt(null); setServer(null); setState("idle");
  }

  if (state === "loading") return <p className="settings-loading">Henter UnraidWatch-indstillinger…</p>;

  return <div className="settings-form">
    <p className="settings-help">
      Nexus henter Unraid-data fra UnraidWatch — ikke direkte fra Unraid-serveren. UnraidWatch ejer forbindelsen,
      API-nøglen og alle Unraid-forespørgsler. Opret et integrations-token i UnraidWatch under <strong>Settings →
      Integrations</strong> og indsæt det her. Tokenet er skrivebeskyttet, krypteres i Nexus og kan tilbagekaldes
      i UnraidWatch når som helst.
    </p>
    <label><span>Navn</span><input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="UnraidWatch" /></label>
    <label>
      <span>{configured ? "Nyt token · kun ved ændring" : "Integrations-token"}</span>
      <input type="password" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="new-password"
        placeholder={configured ? "Lad stå tom for at beholde det nuværende" : "uwk_…"} />
    </label>
    {verifiedAt && <p className="settings-feedback success">
      Forbindelse bekræftet {new Date(verifiedAt).toLocaleString("da-DK")}
      {server && (server.configured ? ` · server: ${server.label}` : " · UnraidWatch har ingen Unraid-server gemt endnu")}.
    </p>}
    {error && <p className="settings-feedback error">{error}</p>}
    <div className="settings-location-actions">
      <button className="primary-action" type="button" disabled={state === "saving" || (!configured && !token.trim())} onClick={() => void save()}>
        {state === "saving" ? "Gemmer…" : configured ? "Gem forbindelse" : "Gem og test"}
      </button>
      {configured && <button className="secondary-action" type="button" disabled={state === "testing"} onClick={() => void test()}>{state === "testing" ? "Tester…" : "Test forbindelse"}</button>}
      {configured && <button className="secondary-action" type="button" onClick={() => void remove()}>Fjern</button>}
    </div>
  </div>;
}
