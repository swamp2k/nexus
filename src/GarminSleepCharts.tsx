import { useState } from "react";

type Point = { time: number; value: number };
type SleepBar = { date: string; seconds: number | null };
type ConsistencyRow = { date: string; bedSeconds: number | null; wakeSeconds: number | null };

const TZ = "Europe/Copenhagen";
const DAY = 24 * 3600;

function clock(ms: number): string {
  return new Intl.DateTimeFormat("da-DK", { hour: "2-digit", minute: "2-digit", timeZone: TZ }).format(new Date(ms));
}

function shortDate(value: string): string {
  return new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "short" }).format(new Date(`${value}T12:00:00Z`));
}

function weekday(value: string): string {
  return new Intl.DateTimeFormat("da-DK", { weekday: "short" }).format(new Date(`${value}T12:00:00Z`));
}

function duration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h} t ${m} min`;
}

function timeOfDay(seconds: number): string {
  const normalized = ((Math.round(seconds / 60) * 60) % DAY + DAY) % DAY;
  const h = Math.floor(normalized / 3600);
  const m = Math.floor((normalized % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function SleepMetricChart({ points, min, max, unit = "" }: { points: Point[]; min?: number; max?: number; unit?: string }) {
  const [active, setActive] = useState<number | null>(null);
  if (points.length < 2) return <div className="sleep-chart-empty">Ingen målinger</div>;

  const width = 720;
  const height = 180;
  const left = 44;
  const right = 10;
  const top = 12;
  const bottom = 30;
  const values = points.map((p) => p.value);
  const rawLow = min ?? Math.min(...values);
  const rawHigh = max ?? Math.max(...values);
  const low = min ?? Math.floor(rawLow / 5) * 5;
  const high = max ?? Math.ceil(rawHigh / 5) * 5;
  const span = Math.max(1, high - low);
  const start = points[0].time;
  const end = points.at(-1)?.time ?? start + 1;
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  const x = (time: number) => left + ((time - start) / Math.max(1, end - start)) * plotW;
  const y = (value: number) => top + (1 - (value - low) / span) * plotH;
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(p.time).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const yTicks = [high, high - span / 2, low];
  const xTicks = [start, start + (end - start) / 2, end];

  function choose(clientX: number, target: SVGSVGElement) {
    const rect = target.getBoundingClientRect();
    const px = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const time = start + px * (end - start);
    let best = 0;
    for (let i = 1; i < points.length; i += 1) if (Math.abs(points[i].time - time) < Math.abs(points[best].time - time)) best = i;
    setActive(best);
  }

  const selected = active === null ? null : points[active];
  return <div className="sleep-axis-chart">
    <svg viewBox={`0 0 ${width} ${height}`}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); choose(e.clientX, e.currentTarget); }}
      onPointerMove={(e) => { if (e.pointerType === "mouse" || e.currentTarget.hasPointerCapture(e.pointerId)) choose(e.clientX, e.currentTarget); }}
      onPointerEnter={(e) => { if (e.pointerType === "mouse") choose(e.clientX, e.currentTarget); }}
      onPointerLeave={(e) => { if (e.pointerType === "mouse") setActive(null); }}
      onPointerUp={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}
      onPointerCancel={() => setActive(null)}>
      {yTicks.map((tick) => { const yy = y(tick); return <g key={tick}><line x1={left} x2={width-right} y1={yy} y2={yy} className="sleep-chart-grid" /><text x={left-6} y={yy+4} textAnchor="end" className="sleep-axis-text">{Math.round(tick)}{unit}</text></g>; })}
      {xTicks.map((tick, i) => <text key={tick} x={x(tick)} y={height-7} textAnchor={i===0?"start":i===2?"end":"middle"} className="sleep-axis-text">{clock(tick)}</text>)}
      <path d={path} className="sleep-chart-line" />
      {selected && <><line x1={x(selected.time)} x2={x(selected.time)} y1={top} y2={height-bottom} className="sleep-crosshair" /><circle cx={x(selected.time)} cy={y(selected.value)} r="5" className="sleep-crosshair-dot" /></>}
    </svg>
    {selected && <div className="sleep-chart-tooltip"><strong>{selected.value.toFixed(unit === "" ? 0 : 1)}{unit}</strong><span>{clock(selected.time)}</span></div>}
  </div>;
}

export function SleepDurationBars({ rows, onSelect }: { rows: SleepBar[]; onSelect: (date: string) => void }) {
  const [active, setActive] = useState<number | null>(null);
  const max = 12 * 3600;
  const ticks = [12, 9, 6, 3, 0];
  return <div className="sleep-bars-chart">
    <div className="sleep-bars-y">{ticks.map((h) => <span key={h} style={{ top: `${(1-h/12)*100}%` }}>{h}t</span>)}</div>
    <div className="sleep-bars-plot">
      {ticks.map((h) => <i key={h} style={{ top: `${(1-h/12)*100}%` }} />)}
      <div className="sleep-duration-bars interactive">{rows.map((row, index) => <button key={row.date} type="button" className={active===index?"active":""}
        onClick={() => onSelect(row.date)}
        onMouseEnter={() => setActive(index)}
        onMouseLeave={() => setActive(null)}
        onPointerDown={(e) => { if (e.pointerType !== "mouse") { e.currentTarget.setPointerCapture(e.pointerId); setActive(index); } }}
        onPointerEnter={(e) => { if (e.pointerType !== "mouse" && e.buttons) setActive(index); }}
        onPointerUp={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}>
        <span style={{ height: `${Math.max(2, Math.min(100, ((row.seconds ?? 0)/max)*100))}%` }} /><small>{shortDate(row.date)}</small>
      </button>)}</div>
      {active !== null && rows[active] && <div className="sleep-bar-tooltip"><strong>{duration(rows[active].seconds)}</strong><span>{shortDate(rows[active].date)}</span></div>}
    </div>
  </div>;
}

export function SleepConsistencyChart({ rows, avgBed, avgWake, onSelect }: { rows: ConsistencyRow[]; avgBed: number | null; avgWake: number | null; onSelect: (date: string) => void }) {
  const [active, setActive] = useState<number | null>(null);
  // Same mental model as Garmin Connect: evening at top, morning at bottom.
  const axisStart = 21 * 3600;
  const axisEnd = 33 * 3600; // 09:00 next day
  const ticks = [21, 25, 29, 33];
  const normalize = (seconds: number | null) => {
    if (seconds === null) return null;
    let value = seconds;
    if (value < 12 * 3600) value += DAY;
    return value;
  };
  const yPct = (seconds: number) => Math.max(0, Math.min(100, ((seconds - axisStart) / (axisEnd - axisStart)) * 100));
  const avgBedN = normalize(avgBed);
  const avgWakeN = normalize(avgWake);
  const selected = active === null ? null : rows[active];

  return <div className="sleep-consistency-axis-chart">
    <div className="sleep-consistency-y">{ticks.map((h) => <span key={h} style={{ top: `${((h-21)/12)*100}%` }}>{timeOfDay(h*3600)}</span>)}</div>
    <div className="sleep-consistency-plot">
      {ticks.map((h) => <i key={h} className="sleep-consistency-grid" style={{ top: `${((h-21)/12)*100}%` }} />)}
      {avgBedN !== null && <i className="sleep-average-line bedtime" style={{ top: `${yPct(avgBedN)}%` }} />}
      {avgWakeN !== null && <i className="sleep-average-line wake" style={{ top: `${yPct(avgWakeN)}%` }} />}
      <div className="sleep-consistency-columns">{rows.map((row, index) => {
        const bed = normalize(row.bedSeconds);
        const wake = normalize(row.wakeSeconds);
        const valid = bed !== null && wake !== null && wake > bed;
        const top = valid ? yPct(bed) : 0;
        const bottom = valid ? yPct(wake) : 0;
        return <button key={row.date} type="button" className={active===index?"active":""}
          onClick={() => onSelect(row.date)}
          onMouseEnter={() => setActive(index)} onMouseLeave={() => setActive(null)}
          onPointerDown={(e) => { if (e.pointerType !== "mouse") { e.currentTarget.setPointerCapture(e.pointerId); setActive(index); } }}
          onPointerEnter={(e) => { if (e.pointerType !== "mouse" && e.buttons) setActive(index); }}
          onPointerUp={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}>
          {valid && <span style={{ top: `${top}%`, height: `${Math.max(1.5, bottom-top)}%` }} />}
          <small>{rows.length <= 8 ? weekday(row.date) : shortDate(row.date)}</small>
        </button>;
      })}</div>
      {selected && <div className="sleep-consistency-tooltip"><strong>{shortDate(selected.date)}</strong><span>{selected.bedSeconds === null ? "—" : timeOfDay(selected.bedSeconds)} → {selected.wakeSeconds === null ? "—" : timeOfDay(selected.wakeSeconds)}</span></div>}
    </div>
    <div className="sleep-consistency-legend"><span><i className="bed" />Søvntid</span><span><i className="avg-bed" />Gns. sengetid</span><span><i className="avg-wake" />Gns. opvågning</span></div>
  </div>;
}
