import { useEffect, useMemo, useState } from "react";

type RangeKey = "1d" | "7d" | "4w" | "1y";
type MetricKey = "steps" | "heart" | "stress" | "bodyBattery" | "respiration";

type HealthRow = {
  date: string;
  steps: number | null;
  step_goal: number | null;
  distance_m: number | null;
  total_calories: number | null;
  active_calories: number | null;
  resting_hr: number | null;
  min_hr: number | null;
  max_hr: number | null;
  avg_stress: number | null;
  max_stress: number | null;
  body_battery_high: number | null;
  body_battery_low: number | null;
  body_battery_charged: number | null;
  body_battery_drained: number | null;
  body_battery_latest: number | null;
  waking_respiration: number | null;
  sleeping_respiration: number | null;
};

type HealthResponse = {
  selected: HealthRow | null;
  history: HealthRow[];
  navigation: { previousDate: string | null; nextDate: string | null };
};

const RANGE_DAYS: Record<RangeKey, number> = { "1d": 1, "7d": 7, "4w": 28, "1y": 365 };

const TITLES: Record<MetricKey, string> = {
  steps: "Skridt",
  heart: "Puls",
  stress: "Stress",
  bodyBattery: "Body Battery",
  respiration: "Respiration",
};

function shortDate(value: string): string {
  return new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "short" }).format(new Date(`${value}T12:00:00Z`));
}

function longDate(value: string): string {
  return new Intl.DateTimeFormat("da-DK", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(`${value}T12:00:00Z`));
}

function mean(rows: HealthRow[], key: keyof HealthRow): number | null {
  const values = rows.map((row) => Number(row[key])).filter((value) => Number.isFinite(value));
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function fmt(value: number | null, unit = "", digits = 0): string {
  return value === null ? "—" : `${value.toLocaleString("da-DK", { maximumFractionDigits: digits, minimumFractionDigits: digits })}${unit}`;
}

function stressClass(value: number): string {
  if (value <= 25) return "health-bar-stress-rest";
  if (value <= 50) return "health-bar-stress-low";
  if (value <= 75) return "health-bar-stress-medium";
  return "health-bar-stress-high";
}

function BarChart({ rows, primary, secondary, min = 0, max, stress = false, goalReached }: {
  rows: HealthRow[];
  primary: (row: HealthRow) => number | null;
  secondary?: (row: HealthRow) => number | null;
  min?: number;
  max?: number;
  stress?: boolean;
  goalReached?: (row: HealthRow) => boolean;
}) {
  const width = 900;
  const height = 260;
  const padX = 28;
  const padY = 24;
  const primaryValues = rows.map(primary);
  const secondaryValues = secondary ? rows.map(secondary) : [];
  const values = [...primaryValues, ...secondaryValues].filter((value): value is number => value !== null && Number.isFinite(value));
  const top = max ?? Math.max(min + 1, ...values, 1);
  const plotHeight = height - padY * 2;
  const plotWidth = width - padX * 2;
  const slot = plotWidth / Math.max(1, rows.length);
  const grouped = Boolean(secondary);
  const barWidth = Math.max(2, Math.min(grouped ? 12 : 20, slot * (grouped ? 0.32 : 0.62)));
  const y = (value: number) => padY + (1 - (value - min) / Math.max(1, top - min)) * plotHeight;
  const baseline = y(min);
  const x = (index: number) => padX + index * slot + slot / 2;

  return <div className="health-chart-wrap health-bar-chart-wrap">
    <svg className="health-chart health-bar-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Historik som søjlediagram">
      {[0, .25, .5, .75, 1].map((step) => <line key={step} x1={padX} x2={width - padX} y1={padY + step * plotHeight} y2={padY + step * plotHeight} className="health-grid-line" />)}
      {rows.map((row, index) => {
        const value = primaryValues[index];
        if (value === null) return null;
        const cx = x(index) - (grouped ? barWidth * 0.58 : barWidth / 2);
        const topY = y(value);
        const cls = stress ? stressClass(value) : goalReached?.(row) ? "health-bar-goal" : "health-bar-primary";
        return <rect key={`${row.date}-p`} x={cx} y={topY} width={barWidth} height={Math.max(2, baseline - topY)} rx="3" className={`health-bar ${cls}`}><title>{`${shortDate(row.date)}: ${Math.round(value)}`}</title></rect>;
      })}
      {secondary && rows.map((row, index) => {
        const value = secondaryValues[index];
        if (value === null) return null;
        const cx = x(index) + barWidth * 0.08;
        const topY = y(value);
        return <rect key={`${row.date}-s`} x={cx} y={topY} width={barWidth} height={Math.max(2, baseline - topY)} rx="3" className="health-bar health-bar-secondary"><title>{`${shortDate(row.date)}: ${Math.round(value)}`}</title></rect>;
      })}
    </svg>
    <div className="health-chart-labels">{rows.map((row, index) => <span key={row.date} style={{ left: `${((index + .5) / Math.max(1, rows.length)) * 100}%` }}>{rows.length > 40 ? (index % Math.ceil(rows.length / 10) === 0 ? shortDate(row.date) : "") : shortDate(row.date)}</span>)}</div>
  </div>;
}

function Stat({ value, label }: { value: string; label: string }) {
  return <div className="health-stat"><strong>{value}</strong><span>{label}</span></div>;
}

function MetricContent({ metric, selected, history, range }: { metric: MetricKey; selected: HealthRow; history: HealthRow[]; range: RangeKey }) {
  const ranged = range === "1d" ? [selected] : history;

  if (metric === "steps") {
    const avgSteps = mean(ranged, "steps");
    const avgGoal = mean(ranged, "step_goal");
    const totalSteps = ranged.reduce((sum, row) => sum + (row.steps ?? 0), 0);
    const distance = ranged.reduce((sum, row) => sum + (row.distance_m ?? 0), 0) / 1000;
    return <>
      <div className="health-stats-grid">
        <Stat value={fmt(range === "1d" ? selected.steps : avgSteps)} label={range === "1d" ? "Skridt" : "Gns. pr. dag"} />
        <Stat value={fmt(range === "1d" ? selected.step_goal : avgGoal)} label={range === "1d" ? "Mål" : "Gns. mål"} />
        <Stat value={range === "1d" ? fmt((selected.distance_m ?? 0) / 1000, " km", 2) : fmt(distance, " km", 1)} label={range === "1d" ? "Distance" : "Total distance"} />
        {range !== "1d" && <Stat value={fmt(totalSteps)} label="Skridt i perioden" />}
      </div>
      {range !== "1d" && <BarChart rows={history} primary={(row) => row.steps} secondary={(row) => row.step_goal} goalReached={(row) => row.steps !== null && row.step_goal !== null && row.steps >= row.step_goal} />}
    </>;
  }

  if (metric === "heart") {
    return <>
      <div className="health-stats-grid">
        <Stat value={fmt(range === "1d" ? selected.resting_hr : mean(ranged, "resting_hr"), " bpm")} label={range === "1d" ? "Hvilepuls" : "Gns. hvilepuls"} />
        <Stat value={fmt(range === "1d" ? selected.max_hr : mean(ranged, "max_hr"), " bpm")} label={range === "1d" ? "Højeste" : "Gns. dagshøj"} />
        {range === "1d" && <Stat value={fmt(selected.min_hr, " bpm")} label="Laveste" />}
      </div>
      {range !== "1d" && <BarChart rows={history} primary={(row) => row.resting_hr} secondary={(row) => row.max_hr} />}
    </>;
  }

  if (metric === "stress") {
    const avg = range === "1d" ? selected.avg_stress : mean(ranged, "avg_stress");
    const maxStress = range === "1d" ? selected.max_stress : mean(ranged, "max_stress");
    return <>
      <div className="health-stats-grid">
        <Stat value={fmt(avg)} label={range === "1d" ? "Stressniveau" : "Gns. stress"} />
        <Stat value={fmt(maxStress)} label={range === "1d" ? "Maks" : "Gns. daglig maks"} />
      </div>
      {range !== "1d" && <><BarChart rows={history} primary={(row) => row.avg_stress} max={100} stress /><div className="health-stress-legend"><span className="health-bar-stress-rest">0–25 Hvile</span><span className="health-bar-stress-low">26–50 Lav</span><span className="health-bar-stress-medium">51–75 Medium</span><span className="health-bar-stress-high">76–100 Høj</span></div></>}
    </>;
  }

  if (metric === "bodyBattery") {
    const high = range === "1d" ? selected.body_battery_high : mean(ranged, "body_battery_high");
    const low = range === "1d" ? selected.body_battery_low : mean(ranged, "body_battery_low");
    const span = high !== null && low !== null ? high - low : null;
    return <>
      <div className="health-stats-grid">
        <Stat value={fmt(high)} label={range === "1d" ? "Høj" : "Gns. high"} />
        <Stat value={fmt(low)} label={range === "1d" ? "Lav" : "Gns. low"} />
        <Stat value={fmt(span)} label={range === "1d" ? "Spænd" : "Gns. spænd"} />
        {range === "1d" && <Stat value={fmt(selected.body_battery_latest)} label="Seneste" />}
      </div>
      {range !== "1d" && <BarChart rows={history} primary={(row) => row.body_battery_high} secondary={(row) => row.body_battery_low} max={100} />}
    </>;
  }

  return <>
    <div className="health-stats-grid">
      <Stat value={fmt(range === "1d" ? selected.waking_respiration : mean(ranged, "waking_respiration"), " brpm")} label={range === "1d" ? "Vågen" : "Gns. vågen"} />
      <Stat value={fmt(range === "1d" ? selected.sleeping_respiration : mean(ranged, "sleeping_respiration"), " brpm")} label={range === "1d" ? "Søvn" : "Gns. søvn"} />
    </div>
    {range !== "1d" && <BarChart rows={history} primary={(row) => row.sleeping_respiration} secondary={(row) => row.waking_respiration} min={6} max={24} />}
  </>;
}

export default function GarminHealthDetail({ metric, initialDate, onClose }: { metric: MetricKey; initialDate: string; onClose: () => void }) {
  const [range, setRange] = useState<RangeKey>("1d");
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [data, setData] = useState<HealthResponse | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [calendarOpen, setCalendarOpen] = useState(false);

  async function load(date: string, nextRange = range) {
    setState("loading");
    try {
      const query = new URLSearchParams({ date, days: String(RANGE_DAYS[nextRange]) });
      const response = await fetch(`/api/garmin/health?${query}`, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setData(await response.json() as HealthResponse);
      setSelectedDate(date);
      setState("ready");
    } catch { setState("error"); }
  }

  useEffect(() => { void load(initialDate, "1d"); }, [initialDate, metric]);

  const history = data?.history ?? [];
  const selected = data?.selected ?? null;
  const rangeLabel = useMemo(() => {
    if (range === "1d") return longDate(selectedDate);
    if (!history.length) return longDate(selectedDate);
    return `${shortDate(history[0].date)} – ${shortDate(history.at(-1)!.date)}`;
  }, [history, range, selectedDate]);

  function changeRange(next: RangeKey) { setRange(next); void load(selectedDate, next); }
  function selectDate(date: string) { setCalendarOpen(false); void load(date, range); }

  return <section className="garmin-deep-dive health-detail" aria-label={TITLES[metric]}>
    <div className="garmin-deep-heading"><div><p className="section-label">Sundhed</p><h3>{TITLES[metric]}</h3></div><button className="secondary-action" type="button" onClick={onClose}>Luk</button></div>
    <div className="health-toolbar">
      <div className="health-date-nav">
        <button type="button" disabled={!data?.navigation.previousDate} onClick={() => data?.navigation.previousDate && void load(data.navigation.previousDate, range)}>‹</button>
        <div className="health-calendar-anchor">
          <button className="health-date-button" type="button" onClick={() => setCalendarOpen((value) => !value)}>▣ {rangeLabel}</button>
          {calendarOpen && <div className="health-date-popover"><input type="date" value={selectedDate} max={new Date().toISOString().slice(0, 10)} onChange={(event) => event.target.value && selectDate(event.target.value)} /><button type="button" onClick={() => setCalendarOpen(false)}>Luk</button></div>}
        </div>
        <button type="button" disabled={!data?.navigation.nextDate} onClick={() => data?.navigation.nextDate && void load(data.navigation.nextDate, range)}>›</button>
      </div>
      <div className="health-range-tabs">{(["1d", "7d", "4w", "1y"] as RangeKey[]).map((item) => <button key={item} type="button" className={range === item ? "active" : ""} onClick={() => changeRange(item)}>{item}</button>)}</div>
    </div>

    {state === "loading" && <p className="empty-state">Henter data…</p>}
    {state === "error" && <p className="empty-state">Data kunne ikke hentes.</p>}
    {state === "ready" && selected && <MetricContent metric={metric} selected={selected} history={history} range={range} />}
  </section>;
}

export type { MetricKey as GarminHealthMetric };
