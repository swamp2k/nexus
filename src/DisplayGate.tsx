import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import KitchenDisplay from "./KitchenDisplay";

type DisplayMe = { paired: boolean; device?: { id: string; name: string; lastSeenAt?: string } };
type Props = { theme: "light" | "dark"; onToggleTheme: () => void };

export default function DisplayGate({ theme, onToggleTheme }: Props) {
  const [state, setState] = useState<"loading" | "paired" | "pairing" | "error">("loading");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/display/me", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<DisplayMe>;
      })
      .then((body) => setState(body.paired ? "paired" : "pairing"))
      .catch(() => setState("error"));
  }, []);

  async function pair(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = code.replace(/\D/g, "");
    if (normalized.length !== 8) { setError("Koden skal være 8 cifre."); return; }
    setError(null);
    try {
      const response = await fetch("/api/display/pair", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: normalized, name: "Køkken-iPad" }),
      });
      if (!response.ok) throw new Error("pair_failed");
      setState("paired");
    } catch { setError("Koden er forkert eller udløbet. Lav en ny kode i Nexus-indstillingerne."); }
  }

  if (state === "paired") return <KitchenDisplay theme={theme} onToggleTheme={onToggleTheme} />;

  return <div className="display-pair-shell">
    <button className="theme-toggle display-pair-theme" onClick={onToggleTheme} aria-label="Skift tema">{theme === "light" ? "☾" : "☀"}</button>
    <section className="display-pair-card">
      <div className="brand-mark">N</div><p className="brand-word">NEXUS DISPLAY</p>
      {state === "loading" && <h1>Finder display…</h1>}
      {state === "error" && <><h1>Display kunne ikke åbnes</h1><p>Genindlæs siden og prøv igen.</p></>}
      {state === "pairing" && <>
        <h1>Par denne skærm</h1><p>Lav en parringskode på en enhed, hvor du allerede er logget ind i Nexus: <strong>Indstillinger → Displays</strong>.</p>
        <form className="display-pair-form" onSubmit={pair}><label htmlFor="display-code">8-cifret kode</label><input id="display-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={8} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 8))} placeholder="12345678" autoFocus /><button className="primary-action" type="submit">Par display</button></form>
        {error && <p className="settings-feedback error">{error}</p>}<small>Koden virker i 10 minutter. Når displayet er parret, behøver denne iPad ikke mail eller almindeligt Nexus-login.</small>
      </>}
    </section>
  </div>;
}
