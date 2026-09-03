import { useEffect, useState } from "react";

type SettingsResponse = {
  configured: boolean;
  meteringPoint: string;
  refreshTokenConfigured: boolean;
};

export default function EloverblikSettings() {
  const [configured, setConfigured] = useState(false);
  const [meteringPoint, setMeteringPoint] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "saving" | "error">("loading");
  const [message, setMessage] = useState("");

  async function load() {
    try {
      const response = await fetch("/api/settings/eloverblik", { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as SettingsResponse;
      setConfigured(data.configured);
      setMeteringPoint(data.meteringPoint ?? "");
      setState("ready");
    } catch {
      setState("error");
      setMessage("Eloverblik-indstillinger kunne ikke hentes.");
    }
  }

  useEffect(() => { void load(); }, []);

  async function save() {
    setState("saving");
    setMessage("");
    try {
      const response = await fetch("/api/settings/eloverblik", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken, meteringPoint }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setConfigured(true);
      setRefreshToken("");
      setMessage("Eloverblik er gemt for din bruger.");
      setState("ready");
    } catch {
      setState("error");
      setMessage("Kunne ikke gemme Eloverblik-indstillingerne.");
    }
  }

  async function clear() {
    setState("saving");
    setMessage("");
    try {
      const response = await fetch("/api/settings/eloverblik", { method: "DELETE", credentials: "same-origin" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setConfigured(false);
      setMeteringPoint("");
      setRefreshToken("");
      setMessage("Eloverblik er fjernet fra din bruger.");
      setState("ready");
    } catch {
      setState("error");
      setMessage("Kunne ikke fjerne Eloverblik-indstillingerne.");
    }
  }

  return (
    <section className="settings-card">
      <div className="settings-card-heading">
        <div>
          <p className="section-label">Strøm · forbrug</p>
          <h3>Eloverblik</h3>
          <p>Gemmes pr. Nexus-bruger. Refresh token vises aldrig igen efter lagring.</p>
        </div>
        <span className={`settings-status ${configured ? "is-ready" : ""}`}>{configured ? "Forbundet" : "Ikke forbundet"}</span>
      </div>

      <label className="settings-field">
        <span>Målepunkt</span>
        <input value={meteringPoint} onChange={(event) => setMeteringPoint(event.target.value)} inputMode="numeric" autoComplete="off" placeholder="18-cifret målepunkts-ID" />
      </label>

      <label className="settings-field">
        <span>Refresh token</span>
        <input type="password" value={refreshToken} onChange={(event) => setRefreshToken(event.target.value)} autoComplete="new-password" placeholder={configured ? "Indtast kun ved ændring" : "Eloverblik refresh token"} />
      </label>

      <div className="settings-actions">
        <button type="button" onClick={() => void save()} disabled={state === "saving" || !refreshToken.trim() || !meteringPoint.trim()}>Gem Eloverblik</button>
        {configured && <button className="secondary-action" type="button" onClick={() => void clear()} disabled={state === "saving"}>Fjern</button>}
      </div>
      {message && <p className="settings-help">{message}</p>}
    </section>
  );
}
