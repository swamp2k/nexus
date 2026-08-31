import { useEffect, useMemo, useState } from "react";
import MotionRouteMap from "./MotionRouteMap";
import MotionTrackChart from "./MotionTrackChart";

type Activity = Record<string, unknown>;
type TrackPoint = Record<string, unknown>;
type Lap = Record<string, unknown>;
type ActivityDetailResponse = {
  activity: Activity;
  previous: Activity[];
  track: TrackPoint[];
  laps: Lap[];
  sourceRecords?: number;
  trackAvailable: boolean;
};

function num(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatDuration(seconds: unknown): string {
  const value = num(seconds);
  if (value === null || value <= 0) return "—";
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const secs = Math.round(value % 60);
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}` : `${minutes}:${String(secs).padStart(2, "0")}`;
}

function formatDate(value: unknown): string {
  if (!value) return "";
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return String(value);
  return new Intl.DateTimeFormat("da-DK", { dateStyle: "full", timeStyle: "short" }).format(parsed);
}

function pace(distanceM: unknown, seconds: unknown): string | null {
  const distance = num(distanceM);
  const duration = num(seconds);
  if (distance === null || duration === null || distance <= 0 || duration <= 0) return null;
  const secondsPerKm = duration / (distance / 1000);
  const minutes = Math.floor(secondsPerKm / 60);
  const secs = Math.round(secondsPerKm % 60);
  return `${minutes}:${String(secs).padStart(2, "0")}/km`;
}

function garminTimeToSeconds(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const match = value.match(/^(?:(\d+) day[s]?, )?(\d+):(\d+):(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  return Number(match[1] ?? 0) * 86400 + Number(match[2]) * 3600 + Number(match[3]) * 60 + Number(match[4]);
}

function Stat({ value, label }: { value: string; label: string }) {
  return <div className="motion-detail-stat"><strong>{value}</strong><span>{label}</span></div>;
}

export default function MotionActivityDetail({ activityId, onBack }: { activityId: string; onBack: () => void }) {
  const [data, setData] = useState<ActivityDetailResponse | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    setState("loading");
    void fetch(`/api/garmin/activity?id=${encodeURIComponent(activityId)}`, { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<ActivityDetailResponse>;
      })
      .then((value) => { setData(value); setState("ready"); })
      .catch(() => setState("error"));
  }, [activityId]);

  const activity = data?.activity;
  const distance = num(activity?.distance_m);
  const totalPace = pace(activity?.distance_m, activity?.duration_seconds);
  const movingPace = pace(activity?.distance_m, activity?.moving_seconds);
  const previous = data?.previous ?? [];
  const track = data?.track ?? [];
  const laps = data?.laps ?? [];

  const comparison = useMemo(() => {
    if (!activity || previous.length === 0) return null;
    const currentDistance = num(activity.distance_m);
    const currentSeconds = num(activity.moving_seconds ?? activity.duration_seconds);
    if (currentDistance === null || currentSeconds === null || currentDistance <= 0) return null;
    const previousPaces = previous.map((row) => {
      const d = num(row.distance_m);
      const s = num(row.moving_seconds ?? row.duration_seconds);
      return d && s ? s / (d / 1000) : null;
    }).filter((value): value is number => value !== null);
    if (!previousPaces.length) return null;
    const avg = previousPaces.reduce((sum, value) => sum + value, 0) / previousPaces.length;
    const now = currentSeconds / (currentDistance / 1000);
    const pct = ((avg - now) / avg) * 100;
    if (Math.abs(pct) < 1) return "Tempoet ligger omtrent som på dine seneste ture af samme type.";
    return pct > 0
      ? `Dit moving pace var ${Math.abs(pct).toFixed(0)}% hurtigere end gennemsnittet af de seneste ${previousPaces.length} ture.`
      : `Dit moving pace var ${Math.abs(pct).toFixed(0)}% langsommere end gennemsnittet af de seneste ${previousPaces.length} ture.`;
  }, [activity, previous]);

  if (state === "loading") return <section className="motion-page"><p className="empty-state">Henter aktivitet…</p></section>;
  if (state === "error" || !activity) return <section className="motion-page"><button className="motion-back" type="button" onClick={onBack}>← Tilbage</button><p className="empty-state">Aktiviteten kunne ikke hentes.</p></section>;

  return (
    <section className="motion-page motion-detail" aria-label="Aktivitetsdetaljer">
      <button className="motion-back" type="button" onClick={onBack}>← Alle aktiviteter</button>

      <section className="motion-detail-head">
        <div>
          <p className="section-label">{String(activity.type ?? "Aktivitet")}</p>
          <h2>{String(activity.name ?? activity.type ?? "Aktivitet")}</h2>
          <p>{formatDate(activity.start_time_local ?? activity.start_time_gmt)}{activity.location_name ? ` · ${String(activity.location_name)}` : ""}</p>
        </div>
        {distance !== null && <strong className="motion-detail-distance">{(distance / 1000).toFixed(2)} km</strong>}
      </section>

      <section className="motion-detail-stats" aria-label="Nøgletal">
        <Stat value={formatDuration(activity.duration_seconds)} label="Tid" />
        {num(activity.moving_seconds) !== null && <Stat value={formatDuration(activity.moving_seconds)} label="I bevægelse" />}
        {totalPace && <Stat value={totalPace} label="Tempo" />}
        {movingPace && <Stat value={movingPace} label="Moving pace" />}
        {num(activity.avg_hr) !== null && <Stat value={`${Math.round(num(activity.avg_hr)!)} bpm`} label="Gns. puls" />}
        {num(activity.max_hr) !== null && <Stat value={`${Math.round(num(activity.max_hr)!)} bpm`} label="Max puls" />}
        {num(activity.calories) !== null && <Stat value={`${Math.round(num(activity.calories)!)} kcal`} label="Kalorier" />}
        {num(activity.steps) !== null && <Stat value={Math.round(num(activity.steps)!).toLocaleString("da-DK")} label="Skridt" />}
        {num(activity.elevation_gain_m) !== null && <Stat value={`+${Math.round(num(activity.elevation_gain_m)!)} m`} label="Stigning" />}
        {num(activity.elevation_loss_m) !== null && <Stat value={`−${Math.round(num(activity.elevation_loss_m)!)} m`} label="Fald" />}
        {num(activity.vo2max) !== null && <Stat value={num(activity.vo2max)!.toFixed(1)} label="VO₂max" />}
      </section>

      <section className="motion-detail-grid">
        <article className="motion-detail-panel motion-route-panel">
          <div className="motion-panel-heading"><div><p className="section-label">Rute</p><h3>GPS-spor</h3></div>{data?.sourceRecords ? <span>{data.sourceRecords.toLocaleString("da-DK")} datapunkter</span> : null}</div>
          {data?.trackAvailable ? <MotionRouteMap track={track} /> : <p className="empty-state">Denne aktivitet har endnu ikke et GPS-spor i Nexus. Kør en ny Garmin-sync for at importere activity detail-data.</p>}
        </article>

        <article className="motion-detail-panel">
          <p className="section-label">Sammenligning</p>
          <h3>Hvordan gik turen?</h3>
          <p>{comparison ?? "Når der er nok sammenlignelige ture, viser Nexus tempo- og performanceforskelle her."}</p>
        </article>
      </section>

      {track.length > 1 && <section className="motion-track-charts" aria-label="Grafer for aktiviteten">
        <MotionTrackChart track={track} metric="hr" />
        <MotionTrackChart track={track} metric="speed" />
        <MotionTrackChart track={track} metric="altitude" />
      </section>}

      {laps.length > 0 && <section className="motion-detail-panel motion-laps">
        <div className="motion-panel-heading"><div><p className="section-label">Laps</p><h3>Segmenter</h3></div><span>{laps.length}</span></div>
        <div className="motion-lap-list">
          {laps.map((lap, index) => {
            const lapDistance = num(lap.distance);
            const movingSeconds = garminTimeToSeconds(lap.moving_time) ?? garminTimeToSeconds(lap.elapsed_time);
            const lapPace = pace(lapDistance === null ? null : lapDistance * 1000, movingSeconds);
            return <div className="motion-lap-row" key={String(lap.lap ?? index)}>
              <strong>{index + 1}</strong>
              <span>{lapDistance !== null ? `${lapDistance.toFixed(2)} km` : "—"}</span>
              <span>{movingSeconds !== null ? formatDuration(movingSeconds) : "—"}</span>
              <span>{lapPace ?? "—"}</span>
              <span>{num(lap.avg_hr) !== null ? `${Math.round(num(lap.avg_hr)!)} bpm` : "—"}</span>
            </div>;
          })}
        </div>
      </section>}
    </section>
  );
}
