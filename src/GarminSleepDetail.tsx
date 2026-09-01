import { useEffect, useMemo, useState } from "react";
import { SleepConsistencyChart, SleepDurationBars, SleepMetricChart } from "./GarminSleepCharts";

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

type SleepResponse = {
  selected: SleepRow | null;
  history: SleepRow[];
  navigation: { previousDate: string | null; nextDate: string | null };
};

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

function SleepRing({ row, label = "Total søvn" }: { row: SleepRow; label?: string }) {
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
  return <div className="sleep-ring" style={{ background: `conic-gradient(${stops.join(",")})` }}><div><strong>{duration(row.sleep_seconds)}</strong><span>{label}</span></div></div>;
}

function SleepStageOverview({ row, average = false }: { row: SleepRow; average?: boolean }) {
  const sleepTotal = row.sleep_seconds ?? 0;
  const windowTotal = sleepTotal + (row.awake_seconds ?? 0);
  return <div className="sleep-daily-top">
    <SleepRing row={row} label={average ? "Gns. søvn" : "Total søvn"} />
    <div className="sleep-stage-summary">{STAGES.map((stage) => <div key={stage}><span><i className={`sleep-stage-${stage}`} />{stageLabel(stage)}</span><strong>{duration(stageSeconds(row, stage))}</strong><small>{windowTotal ? `${Math.round((stageSeconds(row, stage) / windowTotal) * 100)} %` : ""}</small></div>)}</div>
  </div>;
}

function DailyView({ row }: { row: SleepRow }) {
  const detail = row.detail;
  return <div className="sleep-daily-view">
    <SleepStageOverview row={row} />
    {detail?.stages?.length ? <article className="sleep-garmin-section"><h4>Søvnstadier</h4><StageTimeline stages={detail.stages} start={detail.sleepStartMs ?? row.sleep_start_ms ?? detail.stages[0].start} end={detail.sleepEndMs ?? row.sleep_end_ms ?? detail.stages.at(-1)!.end} /></article> : null}
    <div className="sleep-signal-pills"><span>Bevægelse</span><span>Hvilepuls {detail?.restingHeartRate ? `${detail.restingHeartRate} bpm` : ""}</span><span>Body Battery {detail?.bodyBatteryChange === null || detail?.bodyBatteryChange === undefined ? "" : `${detail.bodyBatteryChange > 0 ? "+" : ""}${detail.bodyBatteryChange}`}</span></div>
    <article className="sleep-garmin-section"><h4>Søvnmålinger</h4><div className="sleep-metrics-grid"><div><strong>{detail?.restingHeartRate ? `${detail.restingHeartRate} bpm` : "—"}</strong><span>Hvilepuls</span></div><div><strong>{detail?.bodyBatteryChange === null || detail?.bodyBatteryChange === undefined ? "—" : `${detail.bodyBatteryChange > 0 ? "+" : ""}${detail.bodyBatteryChange}`}</strong><span>Body Battery ændring</span></div><div><strong>{row.avg_respiration === null ? "—" : `${row.avg_respiration.toFixed(0)} brpm`}</strong><span>Gns. respiration</span></div><div><strong>{row.low_respiration === null ? "—" : `${row.low_respiration.toFixed(0)} brpm`}</strong><span>Laveste respiration</span></div></div></article>
    <div className="sleep-signal-grid compact">
      <article className="sleep-garmin-section"><h4>Puls gennem natten</h4><SleepMetricChart points={detail?.heartRate ?? []} unit=" bpm" /></article>
      <article className="sleep-garmin-section"><h4>Body Battery</h4><SleepMetricChart points={detail?.bodyBattery ?? []} min={0} max={100} /></article>
      <article className="sleep-garmin-section"><h4>Stress</h4><SleepMetricChart points={detail?.stress ?? []} min={0} max={100} /></article>
      <article className="sleep-garmin-section"><h4>Respiration</h4><SleepMetricChart points={detail?.respiration ?? []} unit="/min" /></article>
    </div>
  </div>;
}

function averageSleepRow(rows: SleepRow[]): SleepRow | null {
  const valid = rows.filter((row) => (row.sleep_seconds ?? 0) > 0);
  if (!valid.length) return null;
  const mean = (key: "sleep_seconds" | "deep_seconds" | "light_seconds" | "rem_seconds" | "awake_seconds") =>
    valid.reduce((sum, row) => sum + (row[key] ?? 0), 0) / valid.length;
  return {
    date: valid.at(-1)?.date ?? "",
    sleep_start_ms: null,
    sleep_end_ms: null,
    sleep_seconds: mean("sleep_seconds"),
    nap_seconds: null,
    deep_seconds: mean("deep_seconds"),
    light_seconds: mean("light_seconds"),
    rem_seconds: mean("rem_seconds"),
    awake_seconds: mean("awake_seconds"),
    avg_respiration: null,
    low_respiration: null,
    high_respiration: null,
  };
}

type SleepChartRow = { date: string; seconds: number | null; bedSeconds: number | null; wakeSeconds: number | null };

function sleepChartRows(history: SleepRow[], range: RangeKey): SleepChartRow[] {
  const daily = history.map((row) => ({ date: row.date, seconds: row.sleep_seconds, bedSeconds: secondsOfDay(row.sleep_start_ms), wakeSeconds: secondsOfDay(row.sleep_end_ms) }));
  if (range !== "1y") return daily;
  const result: SleepChartRow[] = [];
  for (let index = 0; index < daily.length; index += 7) {
    const slice = daily.slice(index, index + 7);
    const durations = slice.map((row) => row.seconds).filter((value): value is number => value !== null && value > 0);
    const beds = slice.map((row) => row.bedSeconds).filter((value): value is number => value !== null);
    const wakes = slice.map((row) => row.wakeSeconds).filter((value): value is number => value !== null);
    result.push({
      date: slice.at(-1)?.date ?? "",
      seconds: durations.length ? durations.reduce((sum, value) => sum + value, 0) / durations.length : null,
      bedSeconds: circularMean(beds),
      wakeSeconds: circularMean(wakes),
    });
  }
  return result;
}

function RangeView({ history, range, onSelect }: { history: SleepRow[]; range: RangeKey; onSelect: (date: string) => void }) {
  const valid = history.filter((row) => (row.sleep_seconds ?? 0) > 0);
  const avg = valid.length ? valid.reduce((sum, row) => sum + (row.sleep_seconds ?? 0), 0) / valid.length : 0;
  const averageRow = averageSleepRow(history);
  const bedtimes = valid.map((row) => secondsOfDay(row.sleep_start_ms)).filter((value): value is number => value !== null);
  const wakeTimes = valid.map((row) => secondsOfDay(row.sleep_end_ms)).filter((value): value is number => value !== null);
  const avgBed = circularMean(bedtimes);
  const avgWake = circularMean(wakeTimes);
  const plotted = sleepChartRows(history, range);
  const durationRows = plotted.map((row) => ({ date: row.date, seconds: row.seconds }));
  const consistencyRows = plotted.map((row) => ({ date: row.date, bedSeconds: row.bedSeconds, wakeSeconds: row.wakeSeconds }));
  return <div className="sleep-range-view">
    {averageRow && <SleepStageOverview row={averageRow} average />}
    <article className="sleep-garmin-section"><h4>Søvnvarighed {range === "1y" && <small className="sleep-chart-period">· ugegennemsnit</small>}</h4><SleepDurationBars rows={durationRows} onSelect={onSelect} /><div className="sleep-range-stat"><strong>{duration(avg)}</strong><span>Gns. søvnvarighed</span></div></article>
    <article className="sleep-garmin-section"><h4>Søvnrytme {range === "1y" && <small className="sleep-chart-period">· ugegennemsnit</small>}</h4><SleepConsistencyChart rows={consistencyRows} avgBed={avgBed} avgWake={avgWake} onSelect={onSelect} /><div className="sleep-range-stat split"><div><strong>{formatSecondsOfDay(avgBed)}</strong><span>Gns. sengetid</span></div><div><strong>{formatSecondsOfDay(avgWake)}</strong><span>Gns. opvågning</span></div></div></article>
    <div className="sleep-night-list">{[...history].reverse().map((row) => <button key={row.date} type="button" onClick={() => onSelect(row.date)}><div><strong>{longDate(row.date)}</strong><span>{shortDate(row.date)}</span></div><strong>{duration(row.sleep_seconds)}</strong><i className="sleep-mini-ring" /></button>)}</div>
  </div>;
}

export default function GarminSleepDetail({ initialDate, onClose }: { initialDate: string; onClose: () => void }) {
  const [data, setData] = useState<SleepResponse | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [range, setRange] = useState<RangeKey>("4w");

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

  useEffect(() => { setRange("4w"); void load(initialDate, "4w"); }, [initialDate]);
  function changeRange(next: RangeKey) { setRange(next); void load(selectedDate, next); }
  function selectNight(date: string) { setRange("1d"); void load(date, "1d"); }

  const selected = data?.selected ?? null;
  const history = data?.history ?? [];
  const rangeLabel = useMemo(() => {
    if (!history.length) return "";
    if (range === "1d") return longDate(selectedDate);
    return `${shortDate(history[0].date)} – ${shortDate(history.at(-1)!.date)}`;
  }, [history, range, selectedDate]);

  const previousDate = data?.navigation?.previousDate ?? null;
  const nextDate = data?.navigation?.nextDate ?? null;

  return <section className="garmin-deep-dive garmin-sleep-screen" aria-labelledby="sleep-detail-heading">
    <div className="garmin-deep-heading"><div><p className="section-label">Dig deeper</p><h3 id="sleep-detail-heading">Søvn</h3></div><button className="secondary-action" type="button" onClick={onClose}>Luk</button></div>
    <div className="sleep-range-tabs" role="tablist">{(["1d", "7d", "4w", "1y"] as RangeKey[]).map((key) => <button key={key} type="button" role="tab" aria-selected={range === key} className={range === key ? "active" : ""} onClick={() => changeRange(key)}>{key}</button>)}</div>
    {range === "1d" ? <div className="sleep-date-nav">
      <button type="button" className="sleep-date-arrow" aria-label="Forrige nat" title="Forrige nat" disabled={!previousDate || state === "loading"} onClick={() => previousDate && selectNight(previousDate)}>←</button>
      <div className="sleep-range-label">{rangeLabel}</div>
      <button type="button" className="sleep-date-arrow" aria-label="Næste nat" title="Næste nat" disabled={!nextDate || state === "loading"} onClick={() => nextDate && selectNight(nextDate)}>→</button>
    </div> : <div className="sleep-range-label">{rangeLabel}</div>}

    {state === "loading" && <p className="empty-state">Henter søvndata…</p>}
    {state === "error" && <p className="empty-state">Søvndata kunne ikke hentes.</p>}
    {state === "ready" && selected && (range === "1d" ? <DailyView row={selected} /> : <RangeView history={history} range={range} onSelect={selectNight} />)}
  </section>;
}
