import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

type RangeKey = "1d" | "7d" | "4w" | "1y";
type MetricKey = "steps" | "heart" | "stress" | "bodyBattery" | "respiration";
type TooltipState = { index: number; x: number; y: number } | null;

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
const TITLES: Record<MetricKey, string> = { steps: "Skridt", heart: "Puls", stress: "Stress", bodyBattery: "Body Battery", respiration: "Respiration" };
const NUMERIC_KEYS: Array<keyof HealthRow> = ["steps", "step_goal", "distance_m", "total_calories", "active_calories", "resting_hr", "min_hr", "max_hr", "avg_stress", "max_stress", "body_battery_high", "body_battery_low", "body_battery_charged", "body_battery_drained", "body_battery_latest", "waking_respiration", "sleeping_respiration"];

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

function weeklyAverage(rows: HealthRow[]): HealthRow[] {
  const result: HealthRow[] = [];
  for (let index = 0; index < rows.length; index += 7) {
    const slice = rows.slice(index, index + 7);
    if (!slice.length) continue;
    const row = { date: slice.at(-1)!.date } as HealthRow;
    for (const key of NUMERIC_KEYS) row[key] = mean(slice, key) as never;
    result.push(row);
  }
  return result;
}

function chartRows(history: HealthRow[], range: RangeKey): HealthRow[] {
  return range === "1y" ? weeklyAverage(history) : history;
}

function axisNumber(value: number): string {
  if (Math.abs(value) >= 1000) return `${Math.round(value / 1000)}k`;
  if (Math.abs(value) < 10 && value % 1) return value.toFixed(1).replace(".", ",");
  return Math.round(value).toLocaleString("da-DK");
}

function BarChart({ rows, primary, secondary, min = 0, max, stress = false, goalReached, primaryLabel = "Værdi", secondaryLabel = "Sekundær", aggregated = false, selectedDate, onSelect }: {
  rows: HealthRow[];
  selectedDate?: string;
  onSelect?: (date: string) => void;
  primary: (row: HealthRow) => number | null;
  secondary?: (row: HealthRow) => number | null;
  min?: number;
  max?: number;
  stress?: boolean;
  goalReached?: (row: HealthRow) => boolean;
  primaryLabel?: string;
  secondaryLabel?: string;
  aggregated?: boolean;
}) {
  const [hover, setHover] = useState<TooltipState>(null);
  const [expanded, setExpanded] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const width = 900, height = 260, padLeft = 54, padRight = 20, padY = 24;
  const primaryValues = rows.map(primary);
  const secondaryValues = secondary ? rows.map(secondary) : [];
  const values = [...primaryValues, ...secondaryValues].filter((value): value is number => value !== null && Number.isFinite(value));
  const top = max ?? Math.max(min + 1, ...values, 1);
  const plotHeight = height - padY * 2, plotWidth = width - padLeft - padRight, slot = plotWidth / Math.max(1, rows.length);
  const grouped = Boolean(secondary);
  const barWidth = Math.max(3, Math.min(grouped ? 14 : 22, slot * (grouped ? 0.34 : 0.64)));
  const y = (value: number) => padY + (1 - (value - min) / Math.max(1, top - min)) * plotHeight;
  const baseline = y(min);
  const x = (index: number) => padLeft + index * slot + slot / 2;
  const ticks = [0, .25, .5, .75, 1].map((step) => ({ step, value: top - step * (top - min) }));

  useEffect(() => {
    const syncFullscreen = () => {
      if (!document.fullscreenElement) setExpanded(false);
    };
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);

  async function toggleExpanded() {
    const orientation = screen.orientation as unknown as { lock?: (value: "landscape") => Promise<void>; unlock?: () => void };
    if (expanded) {
      if (document.fullscreenElement) {
        try { await document.exitFullscreen(); } catch { /* CSS overlay still closes below */ }
      }
      try { orientation.unlock?.(); } catch { /* optional browser API */ }
      setExpanded(false);
      return;
    }

    setExpanded(true);
    const host = hostRef.current;
    if (host?.requestFullscreen) {
      try { await host.requestFullscreen(); } catch { /* keep CSS fullscreen fallback */ }
    }
    try { await orientation.lock?.("landscape"); } catch { /* users can rotate manually */ }
  }

  function move(clientX: number, clientY: number, svg: SVGSVGElement) {
    const rect = svg.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(0.999999, (clientX - rect.left) / Math.max(1, rect.width)));
    const index = Math.max(0, Math.min(rows.length - 1, Math.floor(ratio * rows.length)));
    const host = svg.parentElement?.getBoundingClientRect() ?? rect;
    setHover({ index, x: Math.max(58, Math.min(host.width - 58, clientX - host.left)), y: Math.max(38, clientY - host.top - 12) });
  }

  const hoveredRow = hover === null ? null : rows[hover.index];
  const hoveredPrimary = hover === null ? null : primaryValues[hover.index];
  const hoveredSecondary = hover === null ? null : secondaryValues[hover.index] ?? null;

  return <div ref={hostRef} className={`health-chart-wrap health-bar-chart-wrap ${expanded ? "is-expanded" : ""}`} onContextMenu={(event) => event.preventDefault()}>
    <div className="health-bar-meta">
      <div className="health-bar-legend"><span><i className="primary" />{primaryLabel}</span>{secondary && <span><i className="secondary" />{secondaryLabel}</span>}</div>
      <div className="health-bar-actions"><button type="button" className="health-chart-expand" onClick={() => void toggleExpanded()}>{expanded ? "Luk fuld skærm" : "⛶ Fuld skærm"}</button></div>
    </div>
    <svg className="health-chart health-bar-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={aggregated ? "Historik som ugentlige gennemsnit" : "Historik som søjlediagram"}
      onPointerEnter={(e) => move(e.clientX, e.clientY, e.currentTarget)}
      onPointerMove={(e) => move(e.clientX, e.clientY, e.currentTarget)}
      onPointerLeave={() => setHover(null)}
      onClick={() => hover !== null && onSelect?.(rows[hover.index].date)}>
      {ticks.map(({ step, value }) => <g key={step}><line x1={padLeft} x2={width - padRight} y1={padY + step * plotHeight} y2={padY + step * plotHeight} className="health-grid-line" /><text x={padLeft - 8} y={padY + step * plotHeight + 4} textAnchor="end" className="health-y-label">{axisNumber(value)}</text></g>)}
      {rows.map((row, index) => {
        const value = primaryValues[index];
        if (value === null) return null;
        const cx = x(index) - (grouped ? barWidth * 0.58 : barWidth / 2), topY = y(value);
        const cls = stress ? stressClass(value) : goalReached?.(row) ? "health-bar-goal" : "health-bar-primary";
        return <rect key={`${row.date}-p`} x={cx} y={topY} width={barWidth} height={Math.max(2, baseline - topY)} rx="3" className={`health-bar ${cls} ${hover?.index === index || row.date === selectedDate ? "active" : ""}`} />;
      })}
      {secondary && rows.map((row, index) => {
        const value = secondaryValues[index];
        if (value === null) return null;
        const cx = x(index) + barWidth * 0.08, topY = y(value);
        return <rect key={`${row.date}-s`} x={cx} y={topY} width={barWidth} height={Math.max(2, baseline - topY)} rx="3" className={`health-bar health-bar-secondary ${hover?.index === index || row.date === selectedDate ? "active" : ""}`} />;
      })}
    </svg>
    {hover && hoveredRow && <div className="health-chart-tooltip cursor-tooltip" style={{ left: hover.x, top: hover.y }}>
      <strong>{aggregated ? `Uge t.o.m. ${shortDate(hoveredRow.date)}` : shortDate(hoveredRow.date)}</strong>
      <span>{primaryLabel}: {hoveredPrimary === null ? "—" : Math.round(hoveredPrimary).toLocaleString("da-DK")}</span>
      {secondary && <span>{secondaryLabel}: {hoveredSecondary === null ? "—" : Math.round(hoveredSecondary).toLocaleString("da-DK")}</span>}
    </div>}
    <div className="health-chart-labels">{rows.map((row, index) => <span key={row.date} style={{ left: `${((index + .5) / Math.max(1, rows.length)) * 100}%` }}>{rows.length > 40 ? (index % Math.ceil(rows.length / 10) === 0 ? shortDate(row.date) : "") : shortDate(row.date)}</span>)}</div>
  </div>;
}

function Stat({ value, label }: { value: string; label: string }) {
  return <div><strong>{value}</strong><span>{label}</span></div>;
}

function Stats({ title, children }: { title: string; children: ReactNode }) {
  return <article className="sleep-garmin-section"><h4>{title}</h4><div className="sleep-metrics-grid">{children}</div></article>;
}

function ChartSection({ title, aggregated, children }: { title: string; aggregated: boolean; children: ReactNode }) {
  return <article className="sleep-garmin-section"><h4>{title} {aggregated && <small className="sleep-chart-period">· ugegennemsnit</small>}</h4>{children}</article>;
}

function MetricContent({ metric, selected, history, range, onSelect }: { metric: MetricKey; selected: HealthRow; history: HealthRow[]; range: RangeKey; onSelect: (date: string) => void }) {
  const day = range === "1d";
  const ranged = day ? [selected] : history;
  const plotted = chartRows(history, range);
  const aggregated = range === "1y";
  const chart = { selectedDate: day ? selected.date : undefined, onSelect, aggregated };
  const period = day ? "Seneste 7 dage" : "Udvikling";

  if (metric === "steps") {
    const totalSteps = ranged.reduce((sum, row) => sum + (row.steps ?? 0), 0);
    const distance = ranged.reduce((sum, row) => sum + (row.distance_m ?? 0), 0) / 1000;
    return <>
      <Stats title="Skridt">
        <Stat value={fmt(day ? selected.steps : mean(ranged, "steps"))} label={day ? "Skridt" : "Gns. pr. dag"} />
        <Stat value={fmt(day ? selected.step_goal : mean(ranged, "step_goal"))} label={day ? "Mål" : "Gns. mål"} />
        <Stat value={day ? fmt((selected.distance_m ?? 0) / 1000, " km", 2) : fmt(distance, " km", 1)} label={day ? "Distance" : "Total distance"} />
        {!day && <Stat value={fmt(totalSteps)} label="Skridt i perioden" />}
      </Stats>
      <ChartSection title={period} aggregated={aggregated}><BarChart rows={plotted} primary={(row) => row.steps} secondary={(row) => row.step_goal} primaryLabel="Skridt" secondaryLabel="Mål" goalReached={(row) => row.steps !== null && row.step_goal !== null && row.steps >= row.step_goal} {...chart} /></ChartSection>
    </>;
  }

  if (metric === "heart") return <>
    <Stats title="Puls">
      <Stat value={fmt(day ? selected.resting_hr : mean(ranged, "resting_hr"), " bpm")} label={day ? "Hvilepuls" : "Gns. hvilepuls"} />
      <Stat value={fmt(day ? selected.max_hr : mean(ranged, "max_hr"), " bpm")} label={day ? "Højeste" : "Gns. dagshøj"} />
      {day && <Stat value={fmt(selected.min_hr, " bpm")} label="Laveste" />}
    </Stats>
    <ChartSection title={period} aggregated={aggregated}><BarChart rows={plotted} primary={(row) => row.resting_hr} secondary={(row) => row.max_hr} primaryLabel="Hvilepuls" secondaryLabel="Dagshøj" {...chart} /></ChartSection>
  </>;

  if (metric === "stress") return <>
    <Stats title="Stress">
      <Stat value={fmt(day ? selected.avg_stress : mean(ranged, "avg_stress"))} label={day ? "Stressniveau" : "Gns. stress"} />
      <Stat value={fmt(day ? selected.max_stress : mean(ranged, "max_stress"))} label={day ? "Maks" : "Gns. daglig maks"} />
    </Stats>
    <ChartSection title={period} aggregated={aggregated}>
      <BarChart rows={plotted} primary={(row) => row.avg_stress} primaryLabel="Stress" max={100} stress {...chart} />
      <div className="health-stress-legend"><span className="health-bar-stress-rest">0–25 Hvile</span><span className="health-bar-stress-low">26–50 Lav</span><span className="health-bar-stress-medium">51–75 Medium</span><span className="health-bar-stress-high">76–100 Høj</span></div>
    </ChartSection>
  </>;

  if (metric === "bodyBattery") {
    const high = day ? selected.body_battery_high : mean(ranged, "body_battery_high"), low = day ? selected.body_battery_low : mean(ranged, "body_battery_low");
    return <>
      <Stats title="Body Battery">
        <Stat value={fmt(high)} label={day ? "Høj" : "Gns. høj"} />
        <Stat value={fmt(low)} label={day ? "Lav" : "Gns. lav"} />
        <Stat value={fmt(high !== null && low !== null ? high - low : null)} label={day ? "Spænd" : "Gns. spænd"} />
        {day && <Stat value={fmt(selected.body_battery_latest)} label="Seneste" />}
      </Stats>
      <ChartSection title={period} aggregated={aggregated}><BarChart rows={plotted} primary={(row) => row.body_battery_high} secondary={(row) => row.body_battery_low} primaryLabel="Høj" secondaryLabel="Lav" max={100} {...chart} /></ChartSection>
    </>;
  }

  return <>
    <Stats title="Respiration">
      <Stat value={fmt(day ? selected.waking_respiration : mean(ranged, "waking_respiration"), " brpm")} label={day ? "Vågen" : "Gns. vågen"} />
      <Stat value={fmt(day ? selected.sleeping_respiration : mean(ranged, "sleeping_respiration"), " brpm")} label={day ? "Søvn" : "Gns. søvn"} />
    </Stats>
    <ChartSection title={period} aggregated={aggregated}><BarChart rows={plotted} primary={(row) => row.sleeping_respiration} secondary={(row) => row.waking_respiration} primaryLabel="Søvn" secondaryLabel="Vågen" min={6} max={24} {...chart} /></ChartSection>
  </>;
}

export default function GarminHealthDetail({ metric, initialDate, onClose }: { metric: MetricKey; initialDate: string; onClose: () => void }) {
  const [range, setRange] = useState<RangeKey>("1d");
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [data, setData] = useState<HealthResponse | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  async function load(date: string, nextRange = range) {
    setState("loading");
    try {
      // The single-day view also loads a week so it can show the small trend chart.
      const days = nextRange === "1d" ? 7 : RANGE_DAYS[nextRange];
      const query = new URLSearchParams({ date, days: String(days) });
      const response = await fetch(`/api/garmin/health?${query}`, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setData(await response.json() as HealthResponse); setSelectedDate(date); setState("ready");
    } catch { setState("error"); }
  }

  useEffect(() => { setRange("1d"); void load(initialDate, "1d"); }, [initialDate, metric]);
  const history = data?.history ?? [], selected = data?.selected ?? null;
  const rangeLabel = useMemo(() => range === "1d" || !history.length ? longDate(selectedDate) : `${shortDate(history[0].date)} – ${shortDate(history.at(-1)!.date)}`, [history, range, selectedDate]);
  const previousDate = data?.navigation.previousDate ?? null, nextDate = data?.navigation.nextDate ?? null;
  function changeRange(next: RangeKey) { setRange(next); void load(selectedDate, next); }
  function selectDate(date: string) { setRange("1d"); void load(date, "1d"); }

  return <section className="garmin-deep-dive garmin-sleep-screen" aria-label={TITLES[metric]}>
    <div className="garmin-deep-heading"><div><p className="section-label">Dig deeper</p><h3>{TITLES[metric]}</h3></div><button className="secondary-action" type="button" onClick={onClose}>Luk</button></div>
    <div className="sleep-range-tabs" role="tablist">{(["1d", "7d", "4w", "1y"] as RangeKey[]).map((key) => <button key={key} type="button" role="tab" aria-selected={range === key} className={range === key ? "active" : ""} onClick={() => changeRange(key)}>{key}</button>)}</div>
    {range === "1d" ? <div className="sleep-date-nav">
      <button type="button" className="sleep-date-arrow" aria-label="Forrige dag" title="Forrige dag" disabled={!previousDate || state === "loading"} onClick={() => previousDate && selectDate(previousDate)}>←</button>
      <div className="sleep-range-label">{rangeLabel}</div>
      <button type="button" className="sleep-date-arrow" aria-label="Næste dag" title="Næste dag" disabled={!nextDate || state === "loading"} onClick={() => nextDate && selectDate(nextDate)}>→</button>
    </div> : <div className="sleep-range-label">{rangeLabel}</div>}
    {state === "loading" && <p className="empty-state">Henter data…</p>}
    {state === "error" && <p className="empty-state">Data kunne ikke hentes.</p>}
    {state === "ready" && selected && <div className={range === "1d" ? "sleep-daily-view" : "sleep-range-view"}><MetricContent metric={metric} selected={selected} history={history} range={range} onSelect={selectDate} /></div>}
  </section>;
}

export type { MetricKey as GarminHealthMetric };
