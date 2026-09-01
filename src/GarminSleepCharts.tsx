import { useState } from "react";

type Point = { time: number; value: number };
type SleepBar = { date: string; seconds: number | null };
type ConsistencyRow = { date: string; bedSeconds: number | null; wakeSeconds: number | null };
type TooltipPos = { x: number; y: number };

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
function pointerPos(clientX: number, clientY: number, element: Element): TooltipPos {
  const rect = element.getBoundingClientRect();
  return { x: Math.max(54, Math.min(rect.width - 54, clientX - rect.left)), y: Math.max(34, clientY - rect.top - 12) };
}

export function SleepMetricChart({ points, min, max, unit = "" }: { points: Point[]; min?: number; max?: number; unit?: string }) {
  const [active, setActive] = useState<number | null>(null);
  const [tooltip, setTooltip] = useState<TooltipPos | null>(null);
  if (points.length < 2) return <div className="sleep-chart-empty">Ingen målinger</div>;

  const width = 720, height = 180, left = 44, right = 10, top = 12, bottom = 30;
  const values = points.map((p) => p.value);
  const rawLow = min ?? Math.min(...values), rawHigh = max ?? Math.max(...values);
  const low = min ?? Math.floor(rawLow / 5) * 5, high = max ?? Math.ceil(rawHigh / 5) * 5;
  const span = Math.max(1, high - low), start = points[0].time, end = points.at(-1)?.time ?? start + 1;
  const plotW = width - left - right, plotH = height - top - bottom;
  const x = (time: number) => left + ((time - start) / Math.max(1, end - start)) * plotW;
  const y = (value: number) => top + (1 - (value - low) / span) * plotH;
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(p.time).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const yTicks = [high, high - span / 2, low], xTicks = [start, start + (end - start) / 2, end];

  function choose(clientX: number, clientY: number, target: SVGSVGElement) {
    const rect = target.getBoundingClientRect();
    const px = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const time = start + px * (end - start);
    let best = 0;
    for (let i = 1; i < points.length; i += 1) if (Math.abs(points[i].time - time) < Math.abs(points[best].time - time)) best = i;
    setActive(best);
    setTooltip(pointerPos(clientX, clientY, target.parentElement ?? target));
  }

  const selected = active === null ? null : points[active];
  return <div className="sleep-axis-chart">
    <svg viewBox={`0 0 ${width} ${height}`}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); choose(e.clientX, e.clientY, e.currentTarget); }}
      onPointerMove={(e) => { if (e.pointerType === "mouse" || e.currentTarget.hasPointerCapture(e.pointerId)) choose(e.clientX, e.clientY, e.currentTarget); }}
      onPointerEnter={(e) => { if (e.pointerType === "mouse") choose(e.clientX, e.clientY, e.currentTarget); }}
      onPointerLeave={(e) => { if (e.pointerType === "mouse") { setActive(null); setTooltip(null); } }}
      onPointerUp={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}
      onPointerCancel={() => { setActive(null); setTooltip(null); }}>
      {yTicks.map((tick) => { const yy = y(tick); return <g key={tick}><line x1={left} x2={width-right} y1={yy} y2={yy} className="sleep-chart-grid" /><text x={left-6} y={yy+4} textAnchor="end" className="sleep-axis-text">{Math.round(tick)}{unit}</text></g>; })}
      {xTicks.map((tick, i) => <text key={tick} x={x(tick)} y={height-7} textAnchor={i===0?"start":i===2?"end":"middle"} className="sleep-axis-text">{clock(tick)}</text>)}
      <path d={path} className="sleep-chart-line" />
      {selected && <><line x1={x(selected.time)} x2={x(selected.time)} y1={top} y2={height-bottom} className="sleep-crosshair" /><circle cx={x(selected.time)} cy={y(selected.value)} r="5" className="sleep-crosshair-dot" /></>}
    </svg>
    {selected && tooltip && <div className="sleep-chart-tooltip cursor-tooltip" style={{ left: tooltip.x, top: tooltip.y }}><strong>{selected.value.toFixed(unit === "" ? 0 : 1)}{unit}</strong><span>{clock(selected.time)}</span></div>}
  </div>;
}

export function SleepDurationBars({ rows, onSelect }: { rows: SleepBar[]; onSelect: (date: string) => void }) {
  const [active, setActive] = useState<number | null>(null);
  const [tooltip, setTooltip] = useState<TooltipPos | null>(null);
  const max = 12 * 3600, ticks = [12, 9, 6, 3, 0];
  const move = (index: number, clientX: number, clientY: number, el: HTMLElement) => { setActive(index); setTooltip(pointerPos(clientX, clientY, el.closest(".sleep-bars-plot") ?? el)); };
  return <div className="sleep-bars-chart">
    <div className="sleep-bars-y">{ticks.map((h) => <span key={h} style={{ top: `${(1-h/12)*100}%` }}>{h}t</span>)}</div>
    <div className="sleep-bars-plot">
      {ticks.map((h) => <i key={h} style={{ top: `${(1-h/12)*100}%` }} />)}
      <div className="sleep-duration-bars interactive">{rows.map((row, index) => <button key={row.date} type="button" className={active===index?"active":""}
        onClick={() => onSelect(row.date)}
        onPointerEnter={(e) => move(index, e.clientX, e.clientY, e.currentTarget)}
        onPointerMove={(e) => move(index, e.clientX, e.clientY, e.currentTarget)}
        onPointerLeave={() => { setActive(null); setTooltip(null); }}>
        <span style={{ height: `${Math.max(2, Math.min(100, ((row.seconds ?? 0)/max)*100))}%` }} /><small>{shortDate(row.date)}</small>
      </button>)}</div>
      {active !== null && rows[active] && tooltip && <div className="sleep-bar-tooltip cursor-tooltip" style={{ left: tooltip.x, top: tooltip.y }}><strong>{duration(rows[active].seconds)}</strong><span>{shortDate(rows[active].date)}</span></div>}
    </div>
  </div>;
}

function unwrapNear(value: number, reference: number): number {
  let result = value;
  while (result - reference > DAY / 2) result -= DAY;
  while (result - reference < -DAY / 2) result += DAY;
  return result;
}

export function SleepConsistencyChart({ rows, avgBed, avgWake, onSelect }: { rows: ConsistencyRow[]; avgBed: number | null; avgWake: number | null; onSelect: (date: string) => void }) {
  const [active, setActive] = useState<number | null>(null);
  const [tooltip, setTooltip] = useState<TooltipPos | null>(null);
  const fallbackBed = rows.find((row) => row.bedSeconds !== null)?.bedSeconds ?? 0;
  const referenceBed = avgBed ?? fallbackBed;
  const normalizedRows = rows.map((row) => {
    if (row.bedSeconds === null || row.wakeSeconds === null) return { ...row, bed: null as number | null, wake: null as number | null };
    const bed = unwrapNear(row.bedSeconds, referenceBed);
    let wake = unwrapNear(row.wakeSeconds, bed + 8 * 3600);
    while (wake <= bed) wake += DAY;
    return { ...row, bed, wake };
  });
  const avgBedN = avgBed === null ? null : unwrapNear(avgBed, referenceBed);
  let avgWakeN = avgWake === null ? null : unwrapNear(avgWake, (avgBedN ?? referenceBed) + 8 * 3600);
  if (avgWakeN !== null && avgBedN !== null) while (avgWakeN <= avgBedN) avgWakeN += DAY;

  const axisValues = normalizedRows.flatMap((row) => row.bed === null || row.wake === null ? [] : [row.bed, row.wake]);
  if (avgBedN !== null) axisValues.push(avgBedN);
  if (avgWakeN !== null) axisValues.push(avgWakeN);
  const rawStart = axisValues.length ? Math.min(...axisValues) : 21 * 3600;
  const rawEnd = axisValues.length ? Math.max(...axisValues) : 33 * 3600;
  const twoHours = 2 * 3600;
  let axisStart = Math.floor((rawStart - 3600) / twoHours) * twoHours;
  let axisEnd = Math.ceil((rawEnd + 3600) / twoHours) * twoHours;
  if (axisEnd - axisStart < 10 * 3600) {
    const middle = (axisStart + axisEnd) / 2;
    axisStart = Math.floor((middle - 5 * 3600) / twoHours) * twoHours;
    axisEnd = axisStart + 10 * 3600;
  }
  const axisSpan = Math.max(1, axisEnd - axisStart);
  const tickCount = 4;
  const ticks = Array.from({ length: tickCount }, (_, index) => axisStart + (axisSpan * index) / (tickCount - 1));
  const yPct = (seconds: number) => Math.max(0, Math.min(100, ((seconds - axisStart) / axisSpan) * 100));
  const selected = active === null ? null : rows[active];
  const move = (index: number, clientX: number, clientY: number, el: HTMLElement) => { setActive(index); setTooltip(pointerPos(clientX, clientY, el.closest(".sleep-consistency-plot") ?? el)); };

  return <div className="sleep-consistency-axis-chart">
    <div className="sleep-consistency-y">{ticks.map((tick) => <span key={tick} style={{ top: `${yPct(tick)}%` }}>{timeOfDay(tick)}</span>)}</div>
    <div className="sleep-consistency-plot">
      {ticks.map((tick) => <i key={tick} className="sleep-consistency-grid" style={{ top: `${yPct(tick)}%` }} />)}
      {avgBedN !== null && <i className="sleep-average-line bedtime" style={{ top: `${yPct(avgBedN)}%` }} />}
      {avgWakeN !== null && <i className="sleep-average-line wake" style={{ top: `${yPct(avgWakeN)}%` }} />}
      <div className="sleep-consistency-columns">{normalizedRows.map((row, index) => {
        const valid = row.bed !== null && row.wake !== null && row.wake > row.bed;
        const top = valid ? yPct(row.bed!) : 0, bottom = valid ? yPct(row.wake!) : 0;
        return <button key={row.date} type="button" className={active===index?"active":""} onClick={() => onSelect(row.date)}
          onPointerEnter={(e) => move(index, e.clientX, e.clientY, e.currentTarget)} onPointerMove={(e) => move(index, e.clientX, e.clientY, e.currentTarget)} onPointerLeave={() => { setActive(null); setTooltip(null); }}>
          {valid && <span style={{ top: `${top}%`, height: `${Math.max(1.5, bottom-top)}%` }} />}<small>{rows.length <= 8 ? weekday(row.date) : shortDate(row.date)}</small>
        </button>;
      })}</div>
      {selected && tooltip && <div className="sleep-consistency-tooltip cursor-tooltip" style={{ left: tooltip.x, top: tooltip.y }}><strong>{shortDate(selected.date)}</strong><span>{selected.bedSeconds === null ? "—" : timeOfDay(selected.bedSeconds)} → {selected.wakeSeconds === null ? "—" : timeOfDay(selected.wakeSeconds)}</span></div>}
    </div>
    <div className="sleep-consistency-legend"><span><i className="bed" />Søvntid</span><span><i className="avg-bed" />Gns. sengetid</span><span><i className="avg-wake" />Gns. opvågning</span></div>
  </div>;
}
