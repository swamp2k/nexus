import { useEffect, useMemo, useState } from "react";

type Stage = "deep" | "light" | "rem" | "awake";
type Point = { time: number; value: number };
type StagePoint = { start: number; end: number; stage: Stage };
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

function stageLabel(stage: Stage): string {
  return { deep: "Dyb", light: "Let", rem: "REM", awake: "Vågen" }[stage];
}

function LineChart({ points, min, max, suffix = "" }: { points: Point[]; min?: number; max?: number; suffix?: string }) {
  if (points.length < 2) return <div className="sleep-chart-empty">Ingen målinger</div>;
  const width = 800;
  const height = 130;
  const pad = 12;
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
  return <div className="sleep-mini-chart"><svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none"><line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} className="sleep-chart-grid" /><path d={path} className="sleep-chart-line" /></svg><div><span>{Math.round(low)}{suffix}</span><span>{Math.round(high)}{suffix}</span></div></div>;
}

function StageTimeline({ stages, start, end }: { stages: StagePoint[]; start: number; end: number }) {
  const width = 1000;
  const height = 150;
  const row = { awake: 12, rem: 45, light: 78, deep: 111 } as const;
  return <div className="sleep-stage-chart"><div className="sleep-stage-labels"><span>Vågen</span><span>REM</span><span>Let</span><span>Dyb</span></div><svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
    {[28, 61, 94, 127].map((y) => <line key={y} x1="0" y1={y} x2={width} y2={y} className="sleep-chart-grid" />)}
    {stages.map((stage, index) => {
      const x = ((stage.start - start) / Math.max(1, end - start)) * width;
      const w = Math.max(2, ((stage.end - stage.start) / Math.max(1, end - start)) * width);
      return <rect key={`${stage.start}-${index}`} x={x} y={row[stage.stage]} width={w} height="22" rx="3" className={`sleep-stage sleep-stage-${stage.stage}`} />;
    })}
  </svg><div className="sleep-stage-times"><span>{clock(start)}</span><span>{clock(end)}</span></div></div>;
}

export default function GarminSleepDetail({ initialDate, onClose }: { initialDate: string; onClose: () => void }) {
  const [data, setData] = useState<SleepResponse | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [selectedDate, setSelectedDate] = useState(initialDate);

  async function load(date: string) {
    setState("loading");
    try {
      const query = new URLSearchParams({ date, days: "30" });
      const response = await fetch(`/api/garmin/sleep?${query}`, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setData(await response.json() as SleepResponse);
      setSelectedDate(date);
      setState("ready");
    } catch { setState("error"); }
  }

  useEffect(() => { void load(initialDate); }, [initialDate]);

  const selected = data?.selected ?? null;
  const history = data?.history ?? [];
  const averageSeconds = useMemo(() => {
    const values = history.map((row) => row.sleep_seconds).filter((value): value is number => typeof value === "number" && value > 0);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  }, [history]);
  const maxHistorySeconds = Math.max(12 * 3600, ...history.map((row) => row.sleep_seconds ?? 0));

  return <section className="garmin-deep-dive" aria-labelledby="sleep-detail-heading">
    <div className="garmin-deep-heading"><div><p className="section-label">Dig deeper</p><h3 id="sleep-detail-heading">Søvn</h3><p>Fordeling, natlig udvikling og 30 dages historik.</p></div><button className="secondary-action" type="button" onClick={onClose}>Luk</button></div>
    {state === "loading" && <p className="empty-state">Henter søvndata…</p>}
    {state === "error" && <p className="empty-state">Søvndata kunne ikke hentes.</p>}
    {state === "ready" && selected && <>
      <div className="sleep-summary-grid">
        <article><span>Total søvn</span><strong>{duration(selected.sleep_seconds)}</strong><small>{clock(selected.sleep_start_ms)} → {clock(selected.sleep_end_ms)}</small></article>
        <article><span>Dyb søvn</span><strong>{duration(selected.deep_seconds)}</strong><small>{selected.sleep_seconds ? `${Math.round(((selected.deep_seconds ?? 0) / selected.sleep_seconds) * 100)} %` : ""}</small></article>
        <article><span>Let søvn</span><strong>{duration(selected.light_seconds)}</strong><small>{selected.sleep_seconds ? `${Math.round(((selected.light_seconds ?? 0) / selected.sleep_seconds) * 100)} %` : ""}</small></article>
        <article><span>REM</span><strong>{duration(selected.rem_seconds)}</strong><small>{selected.sleep_seconds ? `${Math.round(((selected.rem_seconds ?? 0) / selected.sleep_seconds) * 100)} %` : ""}</small></article>
        <article><span>Vågen</span><strong>{duration(selected.awake_seconds)}</strong><small>I søvnvinduet</small></article>
        <article><span>Respiration</span><strong>{selected.avg_respiration === null ? "—" : `${selected.avg_respiration.toFixed(1)}/min`}</strong><small>{selected.low_respiration ?? "—"}–{selected.high_respiration ?? "—"}/min</small></article>
      </div>

      <div className="sleep-composition" aria-label="Fordeling af søvnstadier">
        {(["deep", "light", "rem", "awake"] as Stage[]).map((stage) => {
          const seconds = stage === "deep" ? selected.deep_seconds : stage === "light" ? selected.light_seconds : stage === "rem" ? selected.rem_seconds : selected.awake_seconds;
          const total = (selected.sleep_seconds ?? 0) + (selected.awake_seconds ?? 0);
          const width = total > 0 ? ((seconds ?? 0) / total) * 100 : 0;
          return width > 0 ? <span key={stage} className={`sleep-stage-${stage}`} style={{ width: `${width}%` }} title={`${stageLabel(stage)} ${duration(seconds)}`} /> : null;
        })}
      </div>
      <div className="sleep-legend">{(["deep", "light", "rem", "awake"] as Stage[]).map((stage) => <span key={stage}><i className={`sleep-stage-${stage}`} />{stageLabel(stage)}</span>)}</div>

      {selected.detail?.stages?.length ? <article className="sleep-detail-card"><div className="sleep-card-heading"><div><p className="section-label">Natten</p><h4>Søvnstadier gennem natten</h4></div><strong>{shortDate(selected.date)}</strong></div><StageTimeline stages={selected.detail.stages} start={selected.detail.sleepStartMs ?? selected.sleep_start_ms ?? selected.detail.stages[0].start} end={selected.detail.sleepEndMs ?? selected.sleep_end_ms ?? selected.detail.stages.at(-1)!.end} /></article> : null}

      <div className="sleep-signal-grid">
        <article className="sleep-detail-card"><div className="sleep-card-heading"><div><p className="section-label">Puls</p><h4>Gennem natten</h4></div><strong>{selected.detail?.restingHeartRate ? `${selected.detail.restingHeartRate} bpm` : ""}</strong></div><LineChart points={selected.detail?.heartRate ?? []} suffix=" bpm" /></article>
        <article className="sleep-detail-card"><div className="sleep-card-heading"><div><p className="section-label">Body Battery</p><h4>Opladning under søvn</h4></div><strong>{selected.detail?.bodyBatteryChange === null || selected.detail?.bodyBatteryChange === undefined ? "" : `${selected.detail.bodyBatteryChange > 0 ? "+" : ""}${selected.detail.bodyBatteryChange}`}</strong></div><LineChart points={selected.detail?.bodyBattery ?? []} min={0} max={100} /></article>
        <article className="sleep-detail-card"><div className="sleep-card-heading"><div><p className="section-label">Stress</p><h4>Gennem natten</h4></div></div><LineChart points={selected.detail?.stress ?? []} min={0} max={100} /></article>
        <article className="sleep-detail-card"><div className="sleep-card-heading"><div><p className="section-label">Respiration</p><h4>Åndedrag pr. minut</h4></div></div><LineChart points={selected.detail?.respiration ?? []} suffix="/min" /></article>
      </div>

      <article className="sleep-detail-card sleep-history-card"><div className="sleep-card-heading"><div><p className="section-label">30 dage</p><h4>Søvnlængde</h4></div><strong>Snit {duration(averageSeconds)}</strong></div><div className="sleep-history-chart">
        {history.map((row) => <button key={row.date} type="button" className={row.date === selectedDate ? "active" : ""} title={`${shortDate(row.date)} · ${duration(row.sleep_seconds)}`} onClick={() => void load(row.date)}><span style={{ height: `${Math.max(3, ((row.sleep_seconds ?? 0) / maxHistorySeconds) * 100)}%` }} /><small>{shortDate(row.date)}</small></button>)}
      </div></article>
    </>}
  </section>;
}
