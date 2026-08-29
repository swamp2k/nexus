import { useState } from "react";

type Point = { time: number; value: number };
type SleepBar = { date: string; seconds: number | null };

const TZ = "Europe/Copenhagen";

function clock(ms: number): string {
  return new Intl.DateTimeFormat("da-DK", { hour: "2-digit", minute: "2-digit", timeZone: TZ }).format(new Date(ms));
}

function shortDate(value: string): string {
  return new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "short" }).format(new Date(`${value}T12:00:00Z`));
}

function duration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h} t ${m} min`;
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
    <svg viewBox={`0 0 ${width} ${height}`} onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); choose(e.clientX, e.currentTarget); }} onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) choose(e.clientX, e.currentTarget); }} onPointerUp={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }} onPointerCancel={() => setActive(null)}>
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
      <div className="sleep-duration-bars interactive">{rows.map((row, index) => <button key={row.date} type="button" className={active===index?"active":""} onClick={() => onSelect(row.date)} onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setActive(index); }} onPointerEnter={(e) => { if (e.buttons) setActive(index); }} onPointerUp={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}><span style={{ height: `${Math.max(2, Math.min(100, ((row.seconds ?? 0)/max)*100))}%` }} /><small>{shortDate(row.date)}</small></button>)}</div>
      {active !== null && rows[active] && <div className="sleep-bar-tooltip"><strong>{duration(rows[active].seconds)}</strong><span>{shortDate(rows[active].date)}</span></div>}
    </div>
  </div>;
}
