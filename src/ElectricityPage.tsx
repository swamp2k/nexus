import { useEffect, useMemo, useState } from "react";
import ChartFrame from "./dashboard/ChartFrame";
import { bandFor, bandsFrom, DEFAULT_PRICE_BANDS, DEFAULT_USAGE_BANDS } from "./data/api-types";
import type { Bands, EnergyPricePoint, EnergyPricesResponse, ElectricityUsageResponse, SettingsResponse } from "./data/api-types";

type PricePoint = EnergyPricePoint;
type EnergyResponse = EnergyPricesResponse;
type UsageResponse = ElectricityUsageResponse;
type PriceBands = Bands;
type UsageBands = Bands;
type HourWindow = { start: string; average: number };
type HourBar = { start: string; average: number };

const TIME_ZONE = "Europe/Copenhagen";
const CHART_MAX_DKK = 6;
const DEFAULT_BANDS = DEFAULT_PRICE_BANDS;

function price(point: PricePoint): number {
  return point.totalDkkPerKwh ?? point.approxDkkPerKwh;
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("da-DK", { hour: "2-digit", minute: "2-digit", timeZone: TIME_ZONE }).format(new Date(value));
}

function formatHour(value: string): string {
  return new Intl.DateTimeFormat("da-DK", { hour: "2-digit", timeZone: TIME_ZONE }).format(new Date(value));
}

function localHourKey(value: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false, timeZone: TIME_ZONE }).formatToParts(new Date(value));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}-${map.hour}`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("da-DK", { weekday: "long", day: "numeric", month: "long", timeZone: TIME_ZONE }).format(new Date(value));
}

function localDateKey(value: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: TIME_ZONE }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function ageLabel(value: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 60000));
  if (minutes < 1) return "lige nu";
  if (minutes < 60) return `${minutes} min siden`;
  return `${Math.round(minutes / 60)} t siden`;
}

function rollingHours(points: PricePoint[]): HourWindow[] {
  const result: HourWindow[] = [];
  for (let index = 0; index + 3 < points.length; index += 1) {
    const slice = points.slice(index, index + 4);
    result.push({ start: points[index].timeUtc, average: slice.reduce((sum, point) => sum + price(point), 0) / 4 });
  }
  return result;
}

function hourlyBars(points: PricePoint[]): HourBar[] {
  const grouped = new Map<string, PricePoint[]>();
  for (const point of points) {
    const key = localHourKey(point.timeUtc);
    const list = grouped.get(key) ?? [];
    list.push(point);
    grouped.set(key, list);
  }
  return [...grouped.values()].map((items) => ({
    start: items[0].timeUtc,
    average: items.reduce((sum, item) => sum + price(item), 0) / items.length,
  })).slice(0, 25);
}

const bandClass = bandFor;

function UsageSection({ usage, bands }: { usage: UsageResponse | null; bands: UsageBands }) {
  const rows = usage?.data.days.filter((day) => Number.isFinite(day.kwh) && day.kwh >= 0).slice(-7) ?? [];
  if (rows.length === 0) {
    return <article className="electricity-card electricity-usage-card"><div className="electricity-card-heading"><div><p className="section-label">Eloverblik</p><h3>Elforbrug · seneste 7 dage</h3></div></div><div className="electricity-empty">Ingen Eloverblik-forbrugsdata endnu.</div></article>;
  }

  const latest = rows[rows.length - 1];
  const average = rows.reduce((sum, day) => sum + day.kwh, 0) / rows.length;
  const total = rows.reduce((sum, day) => sum + day.kwh, 0);
  const max = Math.max(...rows.map((day) => day.kwh), 1);
  const dayFormatter = new Intl.DateTimeFormat("da-DK", { weekday: "short" });
  const dateFormatter = new Intl.DateTimeFormat("da-DK", { weekday: "long", day: "numeric", month: "short" });

  return <article className="electricity-card electricity-usage-card">
    <div className="electricity-card-heading">
      <div><p className="section-label">Eloverblik</p><h3>Elforbrug · seneste 7 dage</h3></div>
      {usage && <span className="electricity-usage-freshness">Opdateret {ageLabel(usage.fetchedAt)}{usage.stale ? " · forsinket" : ""}</span>}
    </div>
    <div className="electricity-usage-summary">
      <div><span>Seneste døgn</span><strong>{latest.kwh.toFixed(1).replace(".", ",")} kWh</strong><small>{dateFormatter.format(new Date(latest.date + "T12:00:00"))}</small></div>
      <div><span>7-dages gennemsnit</span><strong>{average.toFixed(1).replace(".", ",")} kWh</strong><small>pr. døgn</small></div>
      <div><span>7 dage i alt</span><strong>{total.toFixed(1).replace(".", ",")} kWh</strong><small>{rows.length} registrerede døgn</small></div>
    </div>
    <div className="band-legend electricity-band-legend electricity-usage-band-legend"><span className="low">Lav ≤ {bands.low.toFixed(1).replace(".", ",")} kWh</span><span className="medium">Middel</span><span className="high">Høj ≥ {bands.high.toFixed(1).replace(".", ",")} kWh</span></div>
    <div className="electricity-usage-bars" aria-label="Elforbrug de seneste 7 dage">
      {rows.map((day) => <div className="electricity-usage-bar-item" key={day.date}>
        <strong>{day.kwh.toFixed(1).replace(".", ",")}</strong>
        <div className="electricity-usage-bar-track"><span className={bandClass(day.kwh, bands)} style={{ height: Math.max(5, (day.kwh / max) * 100) + "%" }} /></div>
        <small>{dayFormatter.format(new Date(day.date + "T12:00:00"))}</small>
      </div>)}
    </div>
  </article>;
}

function PriceChart({ points, bands }: { points: PricePoint[]; bands: PriceBands }) {
  const bars = hourlyBars(points);
  if (bars.length === 0) return <div className="electricity-empty">Ingen priser til grafen.</div>;
  const yTicks = Array.from({ length: CHART_MAX_DKK + 1 }, (_, index) => index);
  const hasClippedValues = bars.some((bar) => bar.average > CHART_MAX_DKK);

  return (
    <div className="electricity-chart-wrap">
      <div className="band-legend electricity-band-legend"><span className="low">Lav ≤ {bands.low.toFixed(2)} kr</span><span className="medium">Middel</span><span className="high">Høj ≥ {bands.high.toFixed(2)} kr</span></div>
      <ChartFrame className="electricity-chart" label="Samlet variabel elpris pr. time med fast skala fra 0 til 6 kroner pr. kWh">{({ width, height }) => {
        const padLeft = 40, padRight = 10, padTop = 10, padBottom = 22;
        const plotWidth = width - padLeft - padRight;
        const plotHeight = height - padTop - padBottom;
        const slotWidth = plotWidth / Math.max(1, bars.length);
        const barWidth = Math.max(4, slotWidth * 0.72);
        const baseline = height - padBottom;
        const yForPrice = (value: number) => padTop + (1 - Math.max(0, Math.min(CHART_MAX_DKK, value)) / CHART_MAX_DKK) * plotHeight;
        const labelEvery = Math.max(1, Math.ceil(36 / slotWidth));
        return <>
          {yTicks.map((tick) => <g key={`y-${tick}`}><line x1={padLeft} y1={yForPrice(tick)} x2={width - padRight} y2={yForPrice(tick)} className="chart-grid" /><text x={padLeft - 8} y={yForPrice(tick) + 3.5} textAnchor="end" className="chart-axis">{tick} kr</text></g>)}
          {bars.map((bar, index) => {
            const x = padLeft + index * slotWidth + (slotWidth - barWidth) / 2;
            const barHeight = Math.max(2, baseline - yForPrice(bar.average));
            return <g key={bar.start} className={`chart-bar chart-bar--${bandClass(bar.average, bands)}`}>
              <rect x={x} y={baseline - barHeight} width={barWidth} height={barHeight} rx="4"><title>{formatTime(bar.start)} · {bar.average.toFixed(2)} kr/kWh</title></rect>
              {index % labelEvery === 0 && <text x={x + barWidth / 2} y={height - 6} textAnchor="middle" className="chart-axis">{formatHour(bar.start)}</text>}
            </g>;
          })}
        </>;
      }}</ChartFrame>
      {hasClippedValues && <p className="chart-note electricity-chart-cap-note">Priser over {CHART_MAX_DKK} kr/kWh vises ved toppen af grafen.</p>}
    </div>
  );
}

export default function ElectricityPage() {
  const [response, setResponse] = useState<EnergyResponse | null>(null);
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [bands, setBands] = useState<PriceBands>(DEFAULT_BANDS);
  const [usageBands, setUsageBands] = useState<UsageBands>(DEFAULT_USAGE_BANDS);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  async function refresh() {
    try {
      const [priceResult, usageResult, settingsResult] = await Promise.all([
        fetch("/api/sources/energy/prices", { credentials: "same-origin", cache: "no-store" }),
        fetch("/api/sources/energy/usage", { credentials: "same-origin", cache: "no-store" }),
        fetch("/api/settings", { credentials: "same-origin", cache: "no-store" }),
      ]);
      if (!priceResult.ok) throw new Error(`HTTP ${priceResult.status}`);
      setResponse(await priceResult.json() as EnergyResponse);
      setUsage(usageResult.ok ? await usageResult.json() as UsageResponse : null);
      if (settingsResult.ok) {
        const settings = (await settingsResult.json() as SettingsResponse).settings;
        setBands(bandsFrom(settings.energyLowPriceDkk, settings.energyHighPriceDkk, DEFAULT_BANDS));
        setUsageBands(bandsFrom(settings.energyUsageLowKwh, settings.energyUsageHighKwh, DEFAULT_USAGE_BANDS));
      }
      setState("ready");
    } catch {
      setState("error");
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  const metrics = useMemo(() => {
    if (!response) return null;
    const now = Date.now();
    const future = response.data.intervals.filter((point) => {
      const time = Date.parse(point.timeUtc);
      return time >= now - 15 * 60000 && time <= now + 24 * 60 * 60000;
    });
    const current = future.find((point, index) => {
      const start = Date.parse(point.timeUtc);
      const next = future[index + 1] ? Date.parse(future[index + 1].timeUtc) : start + 15 * 60000;
      return now >= start && now < next;
    }) ?? future[0] ?? null;
    const windows = rollingHours(future);
    const cheapest = windows.length ? windows.reduce((best, item) => item.average < best.average ? item : best) : null;
    const highest = windows.length ? windows.reduce((best, item) => item.average > best.average ? item : best) : null;
    return { future, current, cheapest, highest };
  }, [response]);

  const days = useMemo(() => {
    if (!response) return [];
    const grouped = new Map<string, PricePoint[]>();
    for (const point of response.data.intervals) {
      const key = localDateKey(point.timeUtc);
      const list = grouped.get(key) ?? [];
      list.push(point);
      grouped.set(key, list);
    }
    const todayKey = localDateKey(new Date().toISOString());
    return Array.from(grouped.entries()).filter(([key]) => key >= todayKey).slice(0, 2).map(([key, points]) => {
      const values = points.map(price);
      return { key, label: formatDate(points[0].timeUtc), min: Math.min(...values), max: Math.max(...values), average: values.reduce((sum, value) => sum + value, 0) / values.length };
    });
  }, [response]);

  if (state === "loading") return <section className="electricity-state">Henter elpriser…</section>;
  if (state === "error" || !response || !metrics) return <section className="electricity-state"><strong>Elpriserne kunne ikke hentes.</strong><button className="secondary-action" type="button" onClick={() => void refresh()}>Prøv igen</button></section>;

  const current = metrics.current;
  const supplierInclVat = current ? current.supplierMarkupExVatDkkPerKwh * 1.25 : 0;

  return (
    <section className="electricity-page" aria-labelledby="electricity-heading">
      <article className="electricity-hero">
        <div><p className="section-label">{response.data.area} · {response.data.gridProviderLabel ?? "netselskab ikke valgt"}</p><h2 id="electricity-heading">{current ? `${price(current).toFixed(2)} kr/kWh` : "—"}</h2><strong>Samlet variabel pris lige nu</strong><p>Opdateret {ageLabel(response.fetchedAt)}{response.stale ? " · viser seneste kendte data" : ""}</p></div>
        <div className="electricity-hero-metrics"><div><span>Billigste time</span><strong>{metrics.cheapest ? `${metrics.cheapest.average.toFixed(2)} kr` : "—"}</strong><small>{metrics.cheapest ? `fra ${formatTime(metrics.cheapest.start)}` : ""}</small></div><div><span>Dyreste time</span><strong>{metrics.highest ? `${metrics.highest.average.toFixed(2)} kr` : "—"}</strong><small>{metrics.highest ? `fra ${formatTime(metrics.highest.start)}` : ""}</small></div></div>
      </article>

      <UsageSection usage={usage} bands={usageBands} />

      {current && <article className="electricity-day-card electricity-price-breakdown"><p className="section-label">Pris lige nu</p><div><span>Spot inkl. moms</span><strong>{current.spotInclVatDkkPerKwh.toFixed(2)} kr</strong></div><div><span>Netselskab</span><strong>{current.gridInclVatDkkPerKwh === null ? "—" : `${current.gridInclVatDkkPerKwh.toFixed(2)} kr`}</strong></div><div><span>Energinet</span><strong>{current.energinetInclVatDkkPerKwh.toFixed(2)} kr</strong></div><div><span>Elafgift</span><strong>{current.electricityTaxInclVatDkkPerKwh.toFixed(2)} kr</strong></div><div><span>Elselskabstillæg</span><strong>{supplierInclVat.toFixed(2)} kr</strong></div><div className="electricity-price-total"><span>I alt</span><strong>{price(current).toFixed(2)} kr</strong></div></article>}

      <article className="electricity-card">
        <div className="electricity-card-heading"><div><p className="section-label">Næste døgn</p><h3>Samlet elpris pr. time</h3></div><button className="secondary-action" type="button" onClick={() => void refresh()}>Opdatér</button></div>
        <PriceChart points={metrics.future} bands={bands} />
        <div className="electricity-price-strip-wrap"><div className="electricity-price-strip">{metrics.future.map((point) => <div className="electricity-price-cell" key={point.timeUtc}><span>{formatTime(point.timeUtc)}</span><strong>{price(point).toFixed(2)}</strong></div>)}</div></div>
      </article>

      <div className="electricity-days">{days.map((day) => <article className="electricity-day-card" key={day.key}><p className="section-label">{day.label}</p><div><span>Laveste</span><strong>{day.min.toFixed(2)} kr</strong></div><div><span>Gennemsnit</span><strong>{day.average.toFixed(2)} kr</strong></div><div><span>Højeste</span><strong>{day.max.toFixed(2)} kr</strong></div></article>)}</div>
      <p className="electricity-note">Visningen inkluderer spotpris, moms, nettarif, Energinets system- og nettarif, elafgift og dit konfigurerede kWh-tillæg. Faste månedsabonnementer er ikke fordelt ud på kWh.</p>
    </section>
  );
}
