import { useEffect, useState } from "react";

type Metric = {
  id: string;
  name: string;
  emoji: string;
  direction: "high_good" | "high_bad";
  active: number;
  sortOrder: number;
};

type MetricPatch = Partial<Omit<Metric, "active">> & { active?: boolean };

async function errorText(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: string; detail?: string };
    return body.detail ?? body.error ?? `HTTP ${response.status}`;
  } catch { return `HTTP ${response.status}`; }
}

export default function WellbeingMetricSettings() {
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("🙂");
  const [direction, setDirection] = useState<"high_good" | "high_bad">("high_good");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    const response = await fetch("/api/wellbeing/metrics", { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) throw new Error(await errorText(response));
    setMetrics((await response.json() as { metrics: Metric[] }).metrics);
  }

  useEffect(() => { void refresh().catch(() => setMessage("Målepunkterne kunne ikke hentes.")); }, []);

  async function createMetric() {
    if (!name.trim()) return;
    setBusy(true); setMessage(null);
    try {
      const response = await fetch("/api/wellbeing/metrics", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), emoji, direction }),
      });
      if (!response.ok) throw new Error(await errorText(response));
      setName(""); setEmoji("🙂"); setDirection("high_good");
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Målepunktet kunne ikke oprettes."); }
    finally { setBusy(false); }
  }

  async function patchMetric(metric: Metric, patch: MetricPatch) {
    setBusy(true); setMessage(null);
    try {
      const response = await fetch(`/api/wellbeing/metrics/${metric.id}`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!response.ok) throw new Error(await errorText(response));
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Målepunktet kunne ikke opdateres."); }
    finally { setBusy(false); }
  }

  async function addStarterSet() {
    const starter = [
      ["Mentalt overskud", "🧠", "high_good"],
      ["Træthed", "🥱", "high_bad"],
      ["Smerter", "🩹", "high_bad"],
      ["Søvn", "😴", "high_good"],
      ["Humør", "🙂", "high_good"],
      ["Dagen samlet", "⭐", "high_good"],
    ] as const;
    setBusy(true); setMessage(null);
    try {
      for (const [metricName, metricEmoji, metricDirection] of starter) {
        const response = await fetch("/api/wellbeing/metrics", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: metricName, emoji: metricEmoji, direction: metricDirection }),
        });
        if (!response.ok) throw new Error(await errorText(response));
      }
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Forslagene kunne ikke oprettes."); }
    finally { setBusy(false); }
  }

  return <details className="settings-card settings-collapsible">
    <summary className="settings-card-heading"><div><p className="section-label">Velbefindende</p><h2>Daglige målepunkter</h2><p>Vælg selv hvad du vil score 1–5. Retningen fortæller Nexus om en høj score er positiv eller negativ.</p></div><span className="settings-icon" aria-hidden="true">♥</span></summary>

    <div className="wellbeing-settings">
      {metrics.length === 0 && <div className="wellbeing-starter"><span>Ingen målepunkter endnu.</span><button className="secondary-action" type="button" disabled={busy} onClick={() => void addStarterSet()}>Opret forslag</button></div>}

      {metrics.length > 0 && <div className="wellbeing-settings-list">{metrics.map((metric) => <div key={metric.id} className={`wellbeing-setting-row ${metric.active ? "" : "inactive"}`}>
        <span className="wellbeing-setting-emoji">{metric.emoji}</span>
        <div><strong>{metric.name}</strong><small>{metric.direction === "high_good" ? "5 = godt" : "5 = meget / dårligt"}</small></div>
        <button className="secondary-action" type="button" disabled={busy} onClick={() => void patchMetric(metric, { active: !Boolean(metric.active) })}>{metric.active ? "Skjul" : "Aktivér"}</button>
      </div>)}</div>}

      <div className="wellbeing-new-metric">
        <label><span>Emoji</span><input value={emoji} onChange={(event) => setEmoji(event.target.value)} maxLength={8} /></label>
        <label className="wellbeing-name-input"><span>Navn</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder="Fx koncentration" /></label>
        <label><span>Skala</span><select value={direction} onChange={(event) => setDirection(event.target.value as "high_good" | "high_bad")}><option value="high_good">5 = godt</option><option value="high_bad">5 = meget / dårligt</option></select></label>
        <button className="primary-action" type="button" disabled={busy || !name.trim()} onClick={() => void createMetric()}>Tilføj</button>
      </div>
      {message && <p className="settings-feedback error">{message}</p>}
    </div>
  </details>;
}