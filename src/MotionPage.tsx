import { useEffect, useState } from "react";

type MotionOverview = {
  activities: Array<Record<string, unknown>>;
  counts: { activityCount?: number } | null;
};

function numberValue(row: Record<string, unknown>, key: string): number | null {
  const value = row[key];
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function duration(seconds: unknown): string {
  const value = typeof seconds === "number" ? seconds : Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return "—";
  const hours = Math.floor(value / 3600);
  const minutes = Math.round((value % 3600) / 60);
  return hours ? `${hours} t ${minutes} min` : `${minutes} min`;
}

function activityDate(value: unknown): string {
  if (!value) return "";
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return String(value);
  return new Intl.DateTimeFormat("da-DK", { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

export default function MotionPage() {
  const [overview, setOverview] = useState<MotionOverview | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    void fetch("/api/garmin/overview", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<MotionOverview>;
      })
      .then((data) => { setOverview(data); setState("ready"); })
      .catch(() => setState("error"));
  }, []);

  if (state === "loading") return <section className="motion-page"><p className="empty-state">Henter motionsdata…</p></section>;
  if (state === "error") return <section className="motion-page"><p className="empty-state">Motionsdata kunne ikke hentes.</p></section>;

  const activities = overview?.activities ?? [];

  return (
    <section className="motion-page" aria-labelledby="motion-heading">
      <div className="module-page-hero motion-page-hero">
        <div className="module-page-icon tone-teal">↗</div>
        <div><p className="section-label">Træning</p><h2 id="motion-heading">Motion</h2><p>Aktiviteter og træningshistorik samlet ét sted.</p></div>
      </div>

      <section className="motion-overview">
        <div className="motion-heading">
          <div><p className="section-label">Aktiviteter</p><h3>{overview?.counts?.activityCount ?? activities.length} registreret</h3></div>
        </div>

        {activities.length === 0 ? <p className="empty-state">Der er endnu ingen aktiviteter at vise.</p> : <div className="motion-activity-list">
          {activities.map((activity) => {
            const distance = numberValue(activity, "distance_m");
            const heartRate = numberValue(activity, "avg_hr");
            return <article key={String(activity.activity_id)} className="motion-activity-card">
              <div className="motion-activity-copy">
                <strong>{String(activity.name ?? activity.type ?? "Aktivitet")}</strong>
                <span>{activityDate(activity.start_time_local ?? activity.start_time_gmt)}</span>
              </div>
              <div className="motion-activity-stats">
                {distance !== null && <span><strong>{(distance / 1000).toFixed(1)} km</strong><small>Distance</small></span>}
                <span><strong>{duration(activity.duration_seconds)}</strong><small>Varighed</small></span>
                {heartRate !== null && <span><strong>{Math.round(heartRate)} bpm</strong><small>Gns. puls</small></span>}
              </div>
            </article>;
          })}
        </div>}
      </section>
    </section>
  );
}
