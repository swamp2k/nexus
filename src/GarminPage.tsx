import { useEffect, useState } from "react";
import GarminSleepDetail from "./GarminSleepDetail";

type GarminOverview = {
  daily: Record<string, unknown> | null;
  sleep: Record<string, unknown> | null;
  rhr: Record<string, unknown> | null;
  activities: Array<Record<string, unknown>>;
  counts: { dailyCount?: number; sleepCount?: number; activityCount?: number } | null;
};

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

export default function GarminPage() {
  const [overview, setOverview] = useState<GarminOverview | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [deepDive, setDeepDive] = useState<"sleep" | null>(null);

  useEffect(() => {
    void fetch("/api/garmin/overview", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<GarminOverview>;
      })
      .then((data) => { setOverview(data); setState("ready"); })
      .catch(() => setState("error"));
  }, []);

  const daily = overview?.daily ?? null;
  const sleep = overview?.sleep ?? null;
  const latestRhr = numberValue(overview?.rhr ?? null, "resting_hr") ?? numberValue(daily, "resting_hr");

  if (state === "loading") return <section className="garmin-page"><p className="empty-state">Henter Garmin-data…</p></section>;
  if (state === "error") return <section className="garmin-page"><p className="empty-state">Garmin-data kunne ikke hentes.</p></section>;

  return (
    <section className="garmin-page" aria-labelledby="garmin-heading">
      <div className="module-page-hero">
        <div className="module-page-icon tone-blue">⌖</div>
        <div><p className="section-label">Sundhed</p><h2 id="garmin-heading">Garmin</h2><p>Din sundheds- og aktivitetshistorik samlet og klar til analyse.</p></div>
      </div>

      {!daily && <p className="empty-state">Der er endnu ingen normaliserede Garmin-data. Importen styres under Indstillinger → Garmin.</p>}

      {daily && <>
        {deepDive ? <section className="garmin-health-overview garmin-health-collapsed">
          <div className="garmin-health-heading">
            <div><p className="section-label">Seneste data</p><h3>{String(daily.date ?? "")}</h3></div>
            <button className="secondary-action" type="button" onClick={() => setDeepDive(null)}>Vis overblik</button>
          </div>
          <p>Overblikket er foldet sammen, mens du graver ned i {deepDive === "sleep" ? "søvndata" : "data"}.</p>
        </section> : <section className="garmin-health-overview">
          <div className="garmin-health-heading"><div><p className="section-label">Seneste data</p><h3>{String(daily.date ?? "")}</h3></div><span>{overview?.counts?.dailyCount ?? 0} dage · {overview?.counts?.activityCount ?? 0} aktiviteter</span></div>
          <div className="garmin-metric-grid">
            <article><span>Steps</span><strong>{numberValue(daily, "steps")?.toLocaleString("da-DK") ?? "—"}</strong><small>Mål {numberValue(daily, "step_goal")?.toLocaleString("da-DK") ?? "—"}</small></article>
            <article><span>Hvilepuls</span><strong>{latestRhr === null ? "—" : `${Math.round(latestRhr)} bpm`}</strong><small>{numberValue(daily, "min_hr") ?? "—"}–{numberValue(daily, "max_hr") ?? "—"} bpm</small></article>
            <article><span>Body Battery</span><strong>{numberValue(daily, "body_battery_latest") ?? "—"}</strong><small>{numberValue(daily, "body_battery_low") ?? "—"} → {numberValue(daily, "body_battery_high") ?? "—"}</small></article>
            <article><span>Stress</span><strong>{numberValue(daily, "avg_stress") ?? "—"}</strong><small>Maks {numberValue(daily, "max_stress") ?? "—"}</small></article>
            <button className="garmin-metric-card garmin-metric-action" type="button" onClick={() => setDeepDive("sleep")}>
              <span>Søvn</span><strong>{hours(sleep?.sleep_seconds)}</strong><small>Dyb {hours(sleep?.deep_seconds)} · REM {hours(sleep?.rem_seconds)}</small><em>Se detaljer ↓</em>
            </button>
            <article><span>Aktive kalorier</span><strong>{numberValue(daily, "active_calories") === null ? "—" : `${Math.round(numberValue(daily, "active_calories")!)} kcal`}</strong><small>Total {Math.round(numberValue(daily, "total_calories") ?? 0)} kcal</small></article>
          </div>

          {overview && overview.activities.length > 0 && <div className="garmin-recent-activities"><p className="section-label">Seneste aktiviteter</p>{overview.activities.map((activity) => (
            <div key={String(activity.activity_id)}><div><strong>{String(activity.name ?? activity.type ?? "Aktivitet")}</strong><span>{String(activity.start_time_local ?? activity.start_time_gmt ?? "")}</span></div><span>{numberValue(activity, "distance_m") === null ? "" : `${(numberValue(activity, "distance_m")! / 1000).toFixed(1)} km`}</span><span>{hours(activity.duration_seconds)}</span></div>
          ))}</div>}
        </section>}

        {deepDive === "sleep" && sleep?.date && <GarminSleepDetail initialDate={String(sleep.date)} onClose={() => setDeepDive(null)} />}

        {!deepDive && <div className="garmin-summary-grid">
          <article className="summary-card"><span className="summary-kicker">Historik</span><strong>{overview?.counts?.dailyCount ?? 0} dage</strong><p>Daglige sundhedsdata klar til trends og sammenligning.</p></article>
          <button className="summary-card garmin-summary-action" type="button" onClick={() => setDeepDive("sleep")}><span className="summary-kicker">Søvn</span><strong>{overview?.counts?.sleepCount ?? 0} nætter</strong><p>Åbn søvnfordeling, natlige signaler og historik.</p></button>
          <article className="summary-card"><span className="summary-kicker">Aktiviteter</span><strong>{overview?.counts?.activityCount ?? 0} aktiviteter</strong><p>Aktiviteter med distance, varighed, puls og øvrige Garmin-metadata.</p></article>
        </div>}
      </>}
    </section>
  );
}
