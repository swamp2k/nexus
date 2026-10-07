import { useEffect, useState } from "react";

type TokenInfo = { exists: boolean; createdAt: string | null };
type State = "loading" | "idle" | "saving" | "error";

export default function PrivateeringSettings() {
  const [info, setInfo] = useState<TokenInfo>({ exists: false, createdAt: null });
  const [newToken, setNewToken] = useState<string | null>(null);
  const [state, setState] = useState<State>("loading");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const ingestUrl = typeof window !== "undefined" ? `${window.location.origin}/api/privateering/ingest` : "/api/privateering/ingest";

  async function load() {
    try {
      const response = await fetch("/api/privateering/ingest-token", { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setInfo(await response.json() as TokenInfo);
      setState("idle");
    } catch { setState("error"); setError("Status for ingest-tokenet kunne ikke hentes."); }
  }

  useEffect(() => { void load(); }, []);

  async function generate() {
    if (info.exists && !confirm("Et nyt token erstatter det nuværende. Det gamle token holder op med at virke. Fortsæt?")) return;
    setState("saving"); setError(null); setCopied(false);
    try {
      const response = await fetch("/api/privateering/ingest-token", { method: "POST", credentials: "same-origin" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json() as { token: string; createdAt: string };
      setNewToken(body.token);
      setInfo({ exists: true, createdAt: body.createdAt });
      setState("idle");
    } catch { setState("error"); setError("Tokenet kunne ikke oprettes."); }
  }

  async function revoke() {
    if (!confirm("Tilbagekald ingest-tokenet? Copyarr kan ikke længere sende data, før der oprettes et nyt.")) return;
    setState("saving"); setError(null);
    try {
      const response = await fetch("/api/privateering/ingest-token", { method: "DELETE", credentials: "same-origin" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setInfo({ exists: false, createdAt: null });
      setNewToken(null);
      setState("idle");
    } catch { setState("error"); setError("Tokenet kunne ikke tilbagekaldes."); }
  }

  async function copy() {
    if (!newToken) return;
    try {
      await navigator.clipboard.writeText(newToken);
      setCopied(true);
    } catch { /* clipboard not available */ }
  }

  if (state === "loading") return <p className="settings-loading">Henter Privateering-indstillinger…</p>;

  return <div className="settings-form">
    <p className="settings-help">
      Privateering modtager data fra Copyarr via et ingest-token, som du opretter her — ikke en hemmelighed i
      Cloudflare. Indsæt URL'en og tokenet i Copyarr's konfiguration. Genereres et nyt token, holder det gamle op
      med at virke med det samme.
    </p>
    <label><span>Ingest-URL til Copyarr</span><input readOnly value={ingestUrl} onFocus={(event) => event.target.select()} /></label>

    {newToken && <div className="settings-form">
      <label>
        <span>Nyt token · vises kun denne ene gang</span>
        <input readOnly value={newToken} onFocus={(event) => event.target.select()} />
      </label>
      <div className="settings-location-actions">
        <button className="secondary-action" type="button" onClick={() => void copy()}>{copied ? "Kopieret!" : "Kopiér token"}</button>
      </div>
      <p className="settings-help">Gem tokenet et sikkert sted nu — det vises ikke igen.</p>
    </div>}

    {!newToken && info.exists && <p className="settings-feedback success">
      Der er oprettet et ingest-token {info.createdAt ? new Date(info.createdAt).toLocaleString("da-DK") : ""}.
    </p>}
    {!newToken && !info.exists && <p className="settings-help">Der er endnu ikke oprettet et ingest-token.</p>}

    {error && <p className="settings-feedback error">{error}</p>}

    <div className="settings-location-actions">
      <button className="primary-action" type="button" disabled={state === "saving"} onClick={() => void generate()}>
        {state === "saving" ? "Arbejder…" : info.exists ? "Generér nyt token" : "Generér token"}
      </button>
      {info.exists && <button className="secondary-action" type="button" disabled={state === "saving"} onClick={() => void revoke()}>Tilbagekald</button>}
    </div>
  </div>;
}
