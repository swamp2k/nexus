import { useEffect, useMemo, useState } from "react";

type Stage = "deep" | "light" | "rem" | "awake";
type Point = { time: number; value: number };
type StagePoint = { start: number; end: number; stage: Stage };
type RangeKey = "1d" | "7d" | "4w" | "1y";

type SleepRow = {
  date: string;
  sleep_start_ms: number | null;
  sleep_end_ms: number | null;
  sleep_seconds: number | null;
  nap_seconds: number | null;
  deep_seconds: number | null;
  light_seconds: number | null;
  rem_seconds: number | null;
  awake_seconds: number | null;
  avg_respiration: number | null;
  low_respiration: number | null;
  high_respiration: number | null;
  detail?: {
    sleepStartMs: number | null;
    sleepEndMs: number | null;
    bodyBatteryChange: number | null;
    restingHeartRate: number | null;
    stages: StagePoint[];
    heartRate: Point[];
    stress: Point[];
    bodyBattery: Point[];
    respiration: Point[];
  } | null;
};

type SleepResponse = { selected: SleepRow | null; history: SleepRow[] };

const RANGE_DAYS: Record<RangeKey, number> = { "1d": 1, "7d": 7, "4w": 28, "1y": 365 };
const STAGES: Stage[] = ["deep", "light", "rem", "awake"];

function duration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return "—";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return `${hours} t ${minutes} min`;
}

function clock(ms: number | null | undefined): string {
  if (!ms) return "—";
  return new Intl.DateTimeFormat("da-DK", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Copenhagen" }).format(new Date(ms));
}

function shortDate(value: string): string {
  return new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "short" }).format(new Date(`${value}T12:00:00Z`));
}

function longDate(value: string): string {
  return new Intl.DateTimeFormat("da-DK", { weekday: "long", day: "numeric", month: "long" }).format(new Date(`${value}T12:00:00Z`));
}

function stageLabel(stage: Stage): string {
  return { deep: "Dyb", light: "Let", rem: "REM", awake: "Vågen" }[stage];
}

function stageSeconds(row: SleepRow, stage: Stage): number {
  return stage === "deep" ? row.deep_seconds ?? 0 : stage === "light" ? row.light_seconds ?? 0 : stage === "rem" ? row.rem_seconds ?? 0 : row.awake_seconds ?? 0;
}

function secondsOfDay(ms: number | null): number | null {
  if (!ms) return null;
  const parts = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/Copenhagen" }).formatToParts(new Date(ms));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(map.hour) * 3600 + Number(map.minute) * 60;
}

function circularMean(values: number[]): number | null {
  if (!values.length) return null;
  const radians = values.map((value) => (value / 86400) * Math.PI * 2);
  const x = radians.reduce((sum, value) => sum + Math.cos(value), 0) / radians.length;
  const y = radians.reduce((sum, value) => sum + Math.sin(value), 0) / radians.length;
  let angle = Math.atan2(y, x);
  if (angle < 0) angle += Math.PI * 2;
  return (angle / (Math.PI * 2)) * 86400;
}

function formatSecondsOfDay(seconds: number | null): string {
  if (seconds === null) return "—";
  const value = Math.round(seconds / 60) * 60;
  const hour = Math.floor(value / 3600) % 24;
  const minute = Math.floor((value % 3600) / 60);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function Sparkline({ points, min, max }: { points: Point[]; min?: number; max?: number }) {
  if (points.length < 2) return <div className="sleep-chart-empty">Ingen målinger</div>;
  const width = 720;
  const height = 120;
  const pad = 8;
  const start = points[0].time;
  const end = points.at(-1)?.time ?? start + 1;
  const values = points.map((point) => point.value);
  const low = min ?? Math.min(...values);
  const high = max ?? Math.max(...values);
  const span = Math.max(1, high - low);
  const path = points.map((point, index) => {
    const x = pad + ((point.time - start) / Math.max(1, end - start)) * (width - pad * 2);
    const y = height - pad - ((point.value - low) / span) * (height - pad * 2);
    return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return <div className="sleep-sparkline"><svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none"><path d={path} /></svg></div>;
}

function StageTimeline({ stages, start, end }: { stages: StagePoint[]; start: number; end: number }) {
  const row = { awake: 3, rem: 2, light: 1, deep: 0 } as const;
  return <div className="sleep-stage-timeline">
    <div className="sleep-stage-axis"><span>Vågen</span><span>REM</span><span>Let</span><span>Dyb</span></div>
    <div className="sleep-stage-plot">
      {[0, 1, 2, 3].map((level) => <i key={level} style={{ top: `${(3 - level) * 25}%` }} />)}
      {stages.map((stage, index) => {
        const left = ((stage.start - start) / Math.max(1, end - start)) * 100;
        const width = ((stage.end - stage.start) / Math.max(1, end - start)) * 100;
        return <span key={`${stage.start}-${index}`} className={`sleep-stage-block sleep-stage-${stage.stage}`} style={{ left: `${left}%`, width: `${Math.max(0.35, width)}%`, bottom: `${row[stage.stage] * 25}%`, height: `${(row[stage.stage] + 1) * 25}%` }} />;
      })}
    </div>
    <div className="sleep-stage-times"><span>{clock(start)}</span><span>{clock(end)}</span></div>
  </div>;
}

function SleepRing({ row }: { row: SleepRow }) {
  const total = Math.max(1, (row.sleep_seconds ?? 0) + (row.awake_seconds ?? 0));
  let cursor = 0;
  const stops: string[] = [];
  const colors: Record<Stage, string> = { deep: "var(--sleep-deep)", light: "var(--sleep-light)", rem: "var(--sleep-rem)", awake: "var(--sleep-awake)" };
  for (const stage of STAGES) {
    const pct = (stageSeconds(row, stage) / total) * 100;
    if (pct <= 0) continue;
    stops.push(`${colors[stage]} ${cursor}% ${cursor + pct}%`);
    cursor += pct;
  }
  return <div className="sleep-ring" style={{ background: `conic-gradient(${stops.join(",")})` }}><div><strong>{duration(row.sleep_seconds)}</strong><span>Total søvn</span></div></div>;
}

function DailyView({ row }: { row: SleepRow }) {
  const detail = row.detail;
  const sleepTotal = row.sleep_seconds ?? 0;
  const windowTotal = sleepTotal + (row.awake_seconds ?? 0);
  return <div className="sleep-daily-view">
    <div className="sleep-daily-top">
      <SleepRing row={row} />
      <div className="sleep-stage-summary">
        {STAGES.map((stage) => <div key={stage}><span><i className={`sleep-stage-${stage}`} />{stageLabel(stage)}</span><strong>{duration(stageSeconds(row, stage))}</strong><small>{windowTotal ? `${Math.round((stageSeconds(row, stage) / windowTotal) * 100)} %` : ""}</small></div>)}
      </div>
    </div>

    {detail?.stages?.length ? <article className="sleep-garmin-section"><h4>Søvnstadier</h4><StageTimeline stages={detail.stages} start={detail.sleepStartMs ?? row.sleep_start_ms ?? detail.stages[0].start} end={detail.sleepEndMs ?? row.sleep_end_ms ?? detail.stages.at(-1)!.end} /></article> : null}

    <div className="sleep-signal-pills">
      <span>Bevægelse</span><span>Hvilepuls {detail?.restingHeartRate ? `${detail.restingHeartRate} bpm` : ""}</span><span>Body Battery {detail?.bodyBatteryChange === null || detail?.bodyBatteryChange === undefined ? "" : `${detail.bodyBatteryChange > 0 ? "+" : ""}${detail.bodyBatteryChange}`}</span>
    </div>

    <article className="sleep-garmin-section">
      <h4>Søvnmålinger</h4>
      <div className="sleep-metrics-grid">
        <div><strong>{detail?.restingHeartRate ? `${detail.restingHeartRate} bpm` : "—"}</strong><span>Hvilepuls</span></div>
        <div><strong>{detail?.bodyBatteryChange === null || detail?.bodyBatteryChange === undefined ? "—" : `${detail.bodyBatteryChange > 0 ? "+" : ""}${detail.bodyBatteryChange}`}</strong><span>Body Battery ændring</span></div>
        <div><strong>{row.avg_respiration === null ? "—" : `${row.avg_respiration.toFixed(0)} brpm`}</strong><span>Gns. respiration</span></div>
        <div><strong>{row.low_respiration === null ? "—" : `${row.low_respiration.toFixed(0)} brpm`}</strong><span>Laveste respiration</span></div>
      </div>
    </article>

    <div className="sleep-signal-grid compact">
      <article className="sleep-garmin-section"><h4>Puls gennem natten</h4><Sparkline points={detail?.heartRate ?? []} /></article>
      <article className="sleep-garmin-section"><h4>Body Battery</h4><Sparkline points={detail?.bodyBattery ?? []} min={0} max={100} /></article>
      <article className="sleep-garmin-section"><h4>Stress</h4><Sparkline points={detail?.stress ?? []} min={0} max={100} /></article>
      <article className="sleep-garmin-section"><h4>Respiration</h4><Sparkline points={detail?.respiration ?? []} /></article>
    </div>
  </div>;
}

function RangeView({ history, onSelect }: { history: SleepRow[]; onSelect: (date: string) => void }) {
  const valid = history.filter((row) => (row.sleep_seconds ?? 0) > 0);
  const max = Math.max(12 * 3600, ...valid.map((row) => row.sleep_seconds ?? 0));
  const avg = valid.length ? valid.reduce((sum, row) => sum + (row.sleep_seconds ?? 0), 0) / valid.length : 0;
  const bedtimes = valid.map((row) => secondsOfDay(row.sleep_start_ms)).filter((value): value is number => value !== null).map((value) => value < 12 * 3600 ? value + 86400 : value);
  const wakeTimes = valid.map((row) => secondsOfDay(row.sleep_end_ms)).filter((value): value is number => value !== null);
  const avgBed = circularMean(bedtimes.map((value) => value % 86400));
  const avgWake = circularMean(wakeTimes);

  return <div className="sleep-range-view">
    <article className="sleep-garmin-section"><h4>Søvnvarighed</h4><div className="sleep-duration-bars">{history.map((row) => <button key={row.date} type="button" onClick={() => onSelect(row.date)} title={`${shortDate(row.date)} · ${duration(row.sleep_seconds)}`}><span style={{ height: `${Math.max(2, ((row.sleep_seconds ?? 0) / max) * 100)}%` }} /><small>{shortDate(row.date)}</small></button>)}</div><div className="sleep-range-stat"><strong>{duration(avg)}</strong><span>Gns. søvnvarighed</span></div></article>

    <article className="sleep-garmin-section"><h4>Søvnrytme</h4><div className="sleep-consistency-chart">{history.map((row) => {
      let bed = secondsOfDay(row.sleep_start_ms);
      const wake = secondsOfDay(row.sleep_end_ms);
      if (bed === null || wake === null) return <span key={row.date} className="empty" />;
      if (bed < 12 * 3600) bed += 86400;
      const wakeAdjusted = wake < 12 * 3600 ? wake + 86400 : wake;
      const startPct = ((bed - 18 * 3600) / (18 * 3600)) * 100;
      const endPct = ((wakeAdjusted - 18 * 3600) / (18 * 3600)) * 100;
      return <span key={row.date}><i style={{ top: `${Math.max(0, Math.min(100, startPct))}%`, height: `${Math.max(2, Math.min(100, endPct) - Math.max(0, startPct))}%` }} /></span>;
    })}</div><div className="sleep-range-stat split"><div><strong>{formatSecondsOfDay(avgBed)}</strong><span>Gns. sengetid</span></div><div><strong>{formatSecondsOfDay(avgWake)}</strong><span>Gns. opvågning</span></div></div></article>

    <div className="sleep-night-list">{[...history].reverse().map((row) => <button key={row.date} type="button" onClick={() => onSelect(row.date)}><div><strong>{longDate(row.date)}</strong><span>{shortDate(row.date)}</span></div><strong>{duration(row.sleep_seconds)}</strong><i className="sleep-mini-ring" /></button>)}</div>
  </div>;
}

export default function GarminSleepDetail({ initialDate, onClose }: { initialDate: string; onClose: () => void }) {
  const [data, setData] = useState<SleepResponse | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [range, setRange] = useState<RangeKey>("1d");

  async function load(date: string, nextRange = range) {
    setState("loading");
    try {
      const query = new URLSearchParams({ date, days: String(RANGE_DAYS[nextRange]) });
      const response = await fetch(`/api/garmin/sleep?${query}`, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setData(await response.json() as SleepResponse);
      setSelectedDate(date);
      setState("ready");
    } catch { setState("error"); }
  }

  useEffect(() => { void load(initialDate, "1d"); }, [initialDate]);

  function changeRange(next: RangeKey) {
    setRange(next);
    void load(selectedDate, next);
  }

  function selectNight(date: string) {
    setRange("1d");
    void load(date, "1d");
  }

  const selected = data?.selected ?? null;
  const history = data?.history ?? [];
  const rangeLabel = useMemo(() => {
    if (!history.length) return "";
    if (range === "1d") return longDate(selectedDate);
    return `${shortDate(history[0].date)} – ${shortDate(history.at(-1)!.date)}`;
  }, [history, range, selectedDate]);

  return <section className="garmin-deep-dive garmin-sleep-screen" aria-labelledby="sleep-detail-heading">
    <div className="garmin-deep-heading"><div><p className="section-label">Dig deeper</p><h3 id="sleep-detail-heading">Søvn</h3></div><button className="secondary-action" type="button" onClick={onClose}>Luk</button></div>
    <div className="sleep-range-tabs" role="tablist">{(["1d", "7d", "4w", "1y"] as RangeKey[]).map((key) => <button key={key} type="button" role="tab" aria-selected={range === key} className={range === key ? "active" : ""} onClick={() => changeRange(key)}>{key}</button>)}</div>
    <div className="sleep-range-label">{rangeLabel}</div>

    {state === "loading" && <p className="empty-state">Henter søvndata…</p>}
    {state === "error" && <p className="empty-state">Søvndata kunne ikke hentes.</p>}
    {state === "ready" && selected && (range === "1d" ? <DailyView row={selected} /> : <RangeView history={history} onSelect={selectNight} />)}
  </section>;
}
