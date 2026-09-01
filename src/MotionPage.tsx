import { useEffect, useMemo, useState } from "react";
import MotionActivityDetail from "./MotionActivityDetail";

type MotionOverview = {
  activities: Array<Record<string, unknown>>;
  counts: { activityCount?: number } | null;
};

const PAGE_SIZE = 30;

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

function monthLabel(value: unknown): string {
  if (!value) return "Ukendt dato";
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return "Ukendt dato";
  return new Intl.DateTimeFormat("da-DK", { month: "long", year: "numeric" }).format(parsed);
}

export default function MotionPage() {
  const [overview, setOverview] = useState<MotionOverview | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  useEffect(() => {
    void fetch("/api/garmin/activities?limit=100", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<MotionOverview>;
      })
      .then((data) => { setOverview(data); setState("ready"); })
      .catch(() => setState("error"));
  }, []);

  if (selectedActivityId) {
    return <MotionActivityDetail activityId={selectedActivityId} onBack={() => setSelectedActivityId(null)} />;
  }

  if (state === "loading") return <section className="motion-page"><p className="empty-state">Henter motionsdata…</p></section>;
  if (state === "error") return <section className="motion-page"><p className="empty-state">Motionsdata kunne ikke hentes.</p></section>;

  const activities = overview?.activities ?? [];
  const visible = activities.slice(0, visibleCount);
  const grouped = useMemo(() => {
    const groups: Array<{ label: string; items: Array<Record<string, unknown>> }> = [];
    for (const activity of visible) {
      const label = monthLabel(activity.start_time_local ?? activity.start_time_gmt);
      const current = groups.at(-1);
      if (!current || current.label !== label) groups.push({ label, items: [activity] });
      else current.items.push(activity);
    }
    return groups;
  }, [visible]);

  return (
    <section className="motion-page" aria-label="Motion">
      <section className="motion-overview">
        <div className="motion-heading">
          <div><p className="section-label">Aktiviteter</p><h3>{overview?.counts?.activityCount ?? activities.length} registreret</h3></div>
        </div>

        {activities.length === 0 ? <p className="empty-state">Der er endnu ingen aktiviteter at vise.</p> : <>
          <div className="motion-table" role="table" aria-label="Aktivitetshistorik">
            <div className="motion-table-head" role="row">
              <span>Aktivitet</span><span>Dato</span><span>Distance</span><span>Varighed</span><span>Gns. puls</span><span aria-hidden="true" />
            </div>
            {grouped.map((group) => <section className="motion-month-group" key={group.label}>
              <h4>{group.label}</h4>
              {group.items.map((activity) => {
                const distance = numberValue(activity, "distance_m");
                const heartRate = numberValue(activity, "avg_hr");
                const activityId = String(activity.activity_id ?? "");
                return <button key={activityId} className="motion-table-row" type="button" onClick={() => setSelectedActivityId(activityId)}>
                  <strong>{String(activity.name ?? activity.type ?? "Aktivitet")}</strong>
                  <span>{activityDate(activity.start_time_local ?? activity.start_time_gmt)}</span>
                  <span>{distance !== null ? `${(distance / 1000).toFixed(1)} km` : "—"}</span>
                  <span>{duration(activity.duration_seconds)}</span>
                  <span>{heartRate !== null ? `${Math.round(heartRate)} bpm` : "—"}</span>
                  <span className="motion-table-open" aria-hidden="true">›</span>
                </button>;
              })}
            </section>)}
          </div>
          {visibleCount < activities.length && <button className="secondary-action motion-load-more" type="button" onClick={() => setVisibleCount((count) => Math.min(activities.length, count + PAGE_SIZE))}>Vis flere</button>}
        </>}
      </section>
    </section>
  );
}
