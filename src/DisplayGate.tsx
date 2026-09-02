import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import DisplayDashboard from "./DisplayDashboard";
import type { WidgetSize } from "./widgets/widgetRegistry";

type Dashboard = { id: string; name: string; theme: "light" | "dark" | "system"; layout: Array<{ id: string; size: WidgetSize }> };
type DisplayMe = { paired: boolean; device?: { id: string; name: string; lastSeenAt?: string }; dashboard?: Dashboard | null };
type Props = { theme: "light" | "dark"; onThemeChange: (theme: "light" | "dark") => void };

export default function DisplayGate({ theme, onThemeChange }: Props) {
  const [state, setState] = useState<"loading" | "paired" | "pairing" | "error">("loading");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function readDisplay() {
    const response = await fetch("/api/display/me", { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json() as DisplayMe;
    setDashboard(body.dashboard ?? null);
    setState(body.paired && body.dashboard ? "paired" : "pairing");
  }

  useEffect(() => { void readDisplay().catch(() => setState("error")); }, []);

  async function pair(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = code.replace(/\D/g, "");
    if (normalized.length !== 8) { setError("Koden skal være 8 cifre."); return; }
    setError(null);
    try {
      const response = await fetch("/api/display/pair", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: normalized }) });
      if (!response.ok) throw new Error("pair_failed");
      await readDisplay();
    } catch { setError("Koden er forkert eller udløbet. Lav en ny kode under Displays i Nexus."); }
  }

  if (state === "paired" && dashboard) return <DisplayDashboard dashboard={dashboard} theme={theme} onThemeChange={onThemeChange} />;

  return <div className="display-pair-shell">
    <button className="theme-toggle display-pair-theme" onClick={() => onThemeChange(theme === "light" ? "dark" : "light")} aria-label="Skift tema">{theme === "light" ? "☾" : "☀"}</button>
    <section className="display-pair-card">
      <div className="brand-mark">N</div><p className="brand-word">NEXUS DISPLAY</p>
      {state === "loading" && <h1>Finder display…</h1>}
      {state === "error" && <><h1>Display kunne ikke åbnes</h1><p>Genindlæs siden og prøv igen.</p></>}
      {state === "pairing" && <>
        <h1>Par denne skærm</h1><p>Åbn <strong>Displays</strong> på en enhed, hvor du er logget ind i Nexus, vælg dashboardet og lav en parringskode.</p>
        <form className="display-pair-form" onSubmit={pair}><label htmlFor="display-code">8-cifret kode</label><input id="display-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={8} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 8))} placeholder="12345678" autoFocus /><button className="primary-action" type="submit">Par display</button></form>
        {error && <p className="settings-feedback error">{error}</p>}<small>Koden virker i 10 minutter. Skærmen husker derefter sin pairing uden mail-login.</small>
      </>}
    </section>
  </div>;
}
