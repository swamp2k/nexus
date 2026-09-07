import { useEffect, useState } from "react";
import ChartFrame from "./dashboard/ChartFrame";
import { bandFor, type Bands, type ElectricityUsageResponse } from "./data/api-types";

function shift(date: string, days: number) {
  const value = new Date(date + "T12:00:00Z");
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Copenhagen", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
const number = new Intl.NumberFormat("da-DK", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const dateLabel = (date: string) => new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(date + "T12:00:00Z"));

export default function ElectricityUsageHistory({ bands }: { bands: Bands }) {
  const [period, setPeriod] = useState(7);
  const [end, setEnd] = useState(today);
  const [response, setResponse] = useState<ElectricityUsageResponse | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error" | "unconfigured">("loading");
  const [retry, setRetry] = useState(0);
  const from = shift(end, -period);
  useEffect(() => {
    const controller = new AbortController();
    setState("loading");
    setResponse(null);
    async function load() {
      try {
        const result = await fetch(`/api/sources/energy/usage?from=${from}&to=${end}`, { credentials: "same-origin", cache: "no-store", signal: controller.signal });
        if (!result.ok) {
          const body = await result.json() as { error?: string };
          if (body.error === "source_not_configured") { setState("unconfigured"); return; }
          throw new Error("usage_failed");
        }
        const data = await result.json() as ElectricityUsageResponse;
        if (!controller.signal.aborted) { setResponse(data); setState("ready"); }
      } catch {
        if (!controller.signal.aborted) setState("error");
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), 10 * 60 * 1000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [from, end, retry]);

  const rows = response?.data.days.filter(day => day.date >= from && day.date < end && Number.isFinite(day.kwh) && day.kwh >= 0) ?? [];
  const values = new Map(rows.map(day => [day.date, day.kwh]));
  const total = rows.reduce((sum, day) => sum + day.kwh, 0);
  const latest = rows.at(-1);
  const buckets: { key: string; start: string; end: string; kwh: number; count: number; expected: number }[] = [];
  for (let offset = 0; offset < period; offset++) {
    const date = shift(from, offset);
    const key = period <= 30 ? date : period <= 90 ? String(Math.floor(offset / 7)) : date.slice(0, 7);
    let bucket = buckets.at(-1);
    if (!bucket || bucket.key !== key) {
      bucket = { key, start: date, end: date, kwh: 0, count: 0, expected: 0 };
      buckets.push(bucket);
    }
    bucket.end = date;
    bucket.expected++;
    if (values.has(date)) { bucket.kwh += values.get(date)!; bucket.count++; }
  }
  const max = Math.max(10, Math.ceil(Math.max(...buckets.map(bucket => bucket.kwh)) / 10) * 10);
  const grouping = period <= 30 ? "pr. dag" : period <= 90 ? "pr. 7 dage" : "pr. måned";
  return <article className="electricity-card electricity-usage-card">
    <div className="electricity-card-heading">
      <div><p className="section-label">Eloverblik</p><h3>Elforbrug</h3></div>
      {response && <span className="electricity-usage-freshness">{response.stale ? "Viser seneste kendte data" : `Hentet ${dateLabel(response.fetchedAt.slice(0, 10))}`}</span>}
    </div>
    <div className="electricity-history-controls">
      <div className="electricity-history-periods" aria-label="Vælg periode">
        {[7, 30, 90, 365].map(days => <button type="button" className="secondary-action" aria-pressed={period === days} key={days} onClick={() => setPeriod(days)}>{days} dage</button>)}
      </div>
      <div className="electricity-history-navigation">
        <button type="button" className="secondary-action" aria-label="Forrige periode" onClick={() => setEnd(shift(end, -period))}>←</button>
        <label>Til og med <input type="date" value={shift(end, -1)} max={shift(today(), -1)} onChange={event => { if (event.target.value && event.target.validity.valid) setEnd(shift(event.target.value, 1)); }} /></label>
        <button type="button" className="secondary-action" aria-label="Næste periode" disabled={end >= today()} onClick={() => setEnd(shift(end, period) > today() ? today() : shift(end, period))}>→</button>
        {end < today() && <button type="button" className="secondary-action" onClick={() => setEnd(today())}>Seneste</button>}
      </div>
    </div>
    <p className="electricity-history-caption">{dateLabel(from)} – {dateLabel(shift(end, -1))} · {grouping}</p>
    {state === "loading" ? <div className="electricity-empty" role="status">Henter elforbrug…</div>
      : state === "error" ? <div className="electricity-empty" role="alert">Elforbruget kunne ikke hentes.<button type="button" className="secondary-action" onClick={() => setRetry(value => value + 1)}>Prøv igen</button></div>
      : state === "unconfigured" ? <div className="electricity-empty">Tilslut Eloverblik i Indstillinger for at se dit elforbrug.</div>
      : rows.length === 0 ? <div className="electricity-empty">Ingen forbrugsdata for perioden.</div>
      : <>
        <div className="electricity-usage-summary">
          <div><span>Seneste registrerede døgn</span><strong>{number.format(latest!.kwh)} kWh</strong><small>{dateLabel(latest!.date)}</small></div>
          <div><span>Gennemsnit pr. døgn</span><strong>{number.format(total / rows.length)} kWh</strong><small>For {rows.length} registrerede døgn</small></div>
          <div><span>Perioden i alt</span><strong>{number.format(total)} kWh</strong><small>{rows.length} af {period} døgn med data</small></div>
        </div>
        <div className="band-legend electricity-usage-band-legend"><span className="low">Lav ≤ {number.format(bands.low)} kWh/døgn</span><span className="medium">Middel</span><span className="high">Høj ≥ {number.format(bands.high)} kWh/døgn</span></div>
        <ChartFrame className="electricity-history-chart" label={`Elforbrug ${grouping}, ${dateLabel(from)} til ${dateLabel(shift(end, -1))}`}>{({ width, height }) => {
          const left = 48, bottom = height - 26, top = 14;
          const slot = Math.max(1, width - left - 8) / buckets.length;
          const barWidth = Math.max(1, slot * 0.72);
          const y = (value: number) => bottom - value / max * (bottom - top);
          const every = Math.max(1, Math.ceil(48 / slot));
          return <>
            {[0, 0.25, 0.5, 0.75, 1].map(fraction => <g key={fraction}><line className="chart-grid" x1={left} x2={width - 8} y1={y(max * fraction)} y2={y(max * fraction)} /><text className="chart-axis" textAnchor="end" x={left - 6} y={y(max * fraction) + 3}>{new Intl.NumberFormat("da-DK", { maximumFractionDigits: 1 }).format(max * fraction)}</text></g>)}
            {buckets.map((bucket, index) => {
              const x = left + slot * index + (slot - barWidth) / 2;
              const h = Math.max(2, bottom - y(bucket.kwh));
              const label = new Intl.DateTimeFormat("da-DK", period > 90 ? { month: "short", timeZone: "UTC" } : { day: "numeric", month: "numeric", timeZone: "UTC" }).format(new Date(bucket.start + "T12:00:00Z"));
              const detail = `${dateLabel(bucket.start)}${bucket.end !== bucket.start ? ` – ${dateLabel(bucket.end)}` : ""}: ${bucket.count ? `${number.format(bucket.kwh)} kWh · ${bucket.count}/${bucket.expected} døgn` : "Ingen data"}`;
              return <g key={bucket.key} className={`chart-bar chart-bar--${bandFor(bucket.kwh / Math.max(1, bucket.count), bands)}`}>
                {bucket.count ? <rect x={x} y={bottom - h} width={barWidth} height={h} rx={3} opacity={bucket.count < bucket.expected ? 0.55 : 1}><title>{detail}</title></rect> : <text className="chart-axis" x={x + barWidth / 2} y={bottom - 4} textAnchor="middle"><title>{detail}</title>—</text>}
                {index % every === 0 && <text className="chart-axis" x={x + barWidth / 2} y={height - 6} textAnchor="middle">{label}</text>}
              </g>;
            })}
          </>;
        }}</ChartFrame>
        <p className="electricity-history-caption">kWh {grouping}. {period > 30 && "Farver følger gennemsnittet pr. registreret døgn. "}{rows.length < period && "Manglende døgn er udeladt fra total og gennemsnit; lyse søjler har ufuldstændige perioder."}</p>
        <details className="electricity-history-details"><summary>Vis daglige værdier</summary><div className="electricity-history-table"><table><thead><tr><th>Dato</th><th>Forbrug</th></tr></thead><tbody>{Array.from({ length: period }, (_, i) => shift(from, i)).map(date => <tr key={date}><td>{dateLabel(date)}</td><td>{values.has(date) ? `${number.format(values.get(date)!)} kWh` : "—"}</td></tr>)}</tbody></table></div></details>
      </>}
  </article>;
}
