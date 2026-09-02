import { useEffect, useMemo, useState } from "react";

type CachedEnvelope<T> = { data: T; fetchedAt: string; expiresAt: string; stale: boolean; lastErrorAt?: string | null; lastErrorMessage?: string | null };
type EnergyPricePoint = { timeUtc: string; eurPerMwh: number; approxDkkPerKwh: number };
type EnergyPriceData = { source: "Energi Data Service"; area: string; resolutionMinutes: 15; currencyNote: string; intervals: EnergyPricePoint[] };
type PriceBands = { low: number; high: number };
type SettingsResponse = { settings: { energyLowPriceDkk: number | null; energyHighPriceDkk: number | null } };
type UsageDay = { date: string; kwh: number };
type UsageData = { source: "Eloverblik"; days: UsageDay[] };
type WeatherData = { source: "MET Norway"; location: { label: string; latitude: number; longitude: number }; current: { time: string; temperature: number; humidity: number | null; windSpeed: number | null; pressure: number | null; symbol: string | null; precipitationMm: number | null } };
type SourceStatus = { sources: { weather: { configured: boolean; provider: string; label: string }; energyPrices: { configured: boolean; area: string }; electricityUsage: { configured: boolean }; wasteCalendar: { configured: boolean; implementation: string } } };
type CalendarEvent = { id: string; title: string; start: string; sourceName: string };
type CalendarResponse = { events: CalendarEvent[] };
type MelCloudDevice = {
  power: boolean | null; offline: boolean | null; roomTemperature: number | null; roomTemperatureZone1: number | null;
  setTemperature: number | null; setTemperatureZone1: number | null; outdoorTemperature: number | null; tankTemperature: number | null;
  setTankTemperature: number | null; heatPumpFrequency: number | null; waterPump1Status: boolean | null; idleZone1: boolean | null;
  boosterHeater1Status: boolean | null; boosterHeater2Status: boolean | null; immersionHeaterStatus: boolean | null; zone1Name: string | null;
};
type MelCloudResponse = { devices: MelCloudDevice[]; fetchedAt: string };
type KitchenData = {
  prices: CachedEnvelope<EnergyPriceData> | null; usage: CachedEnvelope<UsageData> | null; weather: CachedEnvelope<WeatherData> | null;
  status: SourceStatus | null; bands: PriceBands; calendar: CalendarResponse | null; melcloud: MelCloudResponse | null;
};
type Props = { theme: "light" | "dark"; onToggleTheme: () => void };

const REFRESH_MS = 60_000;
const CHART_MAX_DKK = 6;
const DEFAULT_BANDS: PriceBands = { low: 1, high: 2 };
const WASTE_WORDS = ["rest", "madaffald", "mad affald", "plast", "papir", "pap"];

function localHourLabel(iso: string): string { return new Intl.DateTimeFormat("da-DK", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso)); }
function localHourKey(value: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false, timeZone: "Europe/Copenhagen" }).formatToParts(new Date(value));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}-${map.hour}`;
}
function shortDate(date: string): string { return new Intl.DateTimeFormat("da-DK", { weekday: "short", day: "numeric", month: "numeric" }).format(new Date(`${date}T12:00:00`)); }
function ageLabel(iso?: string | null): string {
  if (!iso) return "ukendt";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds} sek siden`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min siden`;
  return `${Math.round(minutes / 60)} t siden`;
}
function weatherIcon(symbol: string | null): string {
  const value = symbol ?? "";
  if (value.includes("thunder")) return "⛈️"; if (value.includes("sleet")) return "🌨️"; if (value.includes("snow")) return "❄️";
  if (value.includes("rain")) return "🌧️"; if (value.includes("fog")) return "🌫️"; if (value.includes("cloudy")) return "☁️";
  if (value.includes("partlycloudy")) return "⛅"; if (value.includes("fair")) return "🌤️"; if (value.includes("clearsky")) return "☀️"; return "🌡️";
}
function weatherDescription(symbol: string | null): string {
  const value = symbol ?? "";
  if (value.includes("thunder")) return "Torden"; if (value.includes("sleet")) return "Slud"; if (value.includes("snow")) return "Sne";
  if (value.includes("heavyrain")) return "Kraftig regn"; if (value.includes("rain")) return "Regn"; if (value.includes("fog")) return "Tåge";
  if (value.includes("cloudy")) return "Overskyet"; if (value.includes("partlycloudy")) return "Delvist skyet"; if (value.includes("fair")) return "Let skyet"; if (value.includes("clearsky")) return "Klart"; return "Vejr";
}
async function fetchJson<T>(url: string): Promise<T | null> {
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store" });
  if ([409, 501, 503].includes(response.status)) return null;
  if (!response.ok) throw new Error(`${url}:${response.status}`);
  return response.json() as Promise<T>;
}
function bandClass(value: number, bands: PriceBands): string { if (value <= bands.low) return "low"; if (value >= bands.high) return "high"; return "medium"; }
function temp(value: number | null | undefined): string { return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1).replace(".", ",")}°` : "—"; }
function heatPumpState(device: MelCloudDevice): string {
  if (device.offline) return "Offline";
  if (device.power === false) return "Slukket";
  if ((device.heatPumpFrequency ?? 0) > 0 || device.waterPump1Status || device.boosterHeater1Status || device.boosterHeater2Status || device.immersionHeaterStatus) return "Arbejder";
  if (device.idleZone1 === true) return "Hviler";
  return device.power ? "Tændt" : "Online";
}
function normalizeWaste(value: string): string { return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9æøå ]/g, " "); }
function nextWaste(events: CalendarEvent[]): CalendarEvent | null {
  const now = Date.now();
  return events.find((event) => Date.parse(event.start) >= now - 12 * 60 * 60_000 && WASTE_WORDS.some((word) => normalizeWaste(event.title).includes(word))) ?? null;
}
function wasteDateLabel(event: CalendarEvent): string {
  const date = new Date(event.start);
  const today = new Date();
  const dateKey = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const todayKey = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.round((dateKey - todayKey) / 86_400_000);
  if (days === 0) return "I dag";
  if (days === 1) return "I morgen";
  return new Intl.DateTimeFormat("da-DK", { weekday: "long", day: "numeric", month: "short" }).format(date);
}

function PriceChart({ envelope, bands }: { envelope: CachedEnvelope<EnergyPriceData> | null; bands: PriceBands }) {
  const points = useMemo(() => {
    if (!envelope) return [];
    const now = Date.now();
    return envelope.data.intervals.filter((point) => { const t = new Date(point.timeUtc).getTime(); return t >= now - 60 * 60 * 1000 && t <= now + 24 * 60 * 60 * 1000; });
  }, [envelope]);
  const bars = useMemo(() => {
    const grouped = new Map<string, EnergyPricePoint[]>();
    for (const point of points) { const key = localHourKey(point.timeUtc); const list = grouped.get(key) ?? []; list.push(point); grouped.set(key, list); }
    return [...grouped.values()].map((items) => ({ start: items[0].timeUtc, average: items.reduce((sum, item) => sum + item.approxDkkPerKwh, 0) / items.length })).slice(0, 25);
  }, [points]);
  if (!envelope || points.length === 0 || bars.length === 0) return <div className="display-empty">Ingen strømpriser endnu</div>;
  const values = points.map((point) => point.approxDkkPerKwh);
  const min = Math.min(...values);
  const current = points.find((point, index) => { const start = new Date(point.timeUtc).getTime(); const next = points[index + 1] ? new Date(points[index + 1].timeUtc).getTime() : start + 15 * 60 * 1000; return Date.now() >= start && Date.now() < next; }) ?? points[0];
  const width = 760, height = 240, left = 42, right = 8, top = 8, bottom = 30;
  const plotW = width - left - right, plotH = height - top - bottom, slot = plotW / bars.length, barW = Math.max(8, slot * 0.72);
  const y = (value: number) => top + (1 - Math.max(0, Math.min(CHART_MAX_DKK, value)) / CHART_MAX_DKK) * plotH;
  return <div className="display-chart-block">
    <div className="display-metric-row"><div><span className="display-metric-label">Lige nu</span><strong>{current.approxDkkPerKwh.toFixed(2)} kr/kWh</strong></div><div><span className="display-metric-label">Billigst næste 24 t</span><strong>{min.toFixed(2)} kr/kWh</strong></div></div>
    <div className="display-price-legend"><span className="low">Lav ≤ {bands.low.toFixed(2)}</span><span className="medium">Middel</span><span className="high">Høj ≥ {bands.high.toFixed(2)}</span></div>
    <svg className="display-price-bars" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Samlet elpris pr. time med farver for lav, middel og høj pris">
      {[6,5,4,3,2,1,0].map((tick) => { const yy = y(tick); return <g key={tick}><line x1={left} y1={yy} x2={width-right} y2={yy} className="display-gridline" /><text x={left-6} y={yy+4} textAnchor="end" className="display-price-axis">{tick}</text></g>; })}
      {bars.map((bar, index) => { const xx = left + index * slot + (slot - barW) / 2, yy = y(bar.average); return <g key={bar.start} className={`display-price-bar display-price-bar--${bandClass(bar.average, bands)}`}><rect x={xx} y={yy} width={barW} height={Math.max(1, height-bottom-yy)} rx="3"><title>{localHourLabel(bar.start)} · {bar.average.toFixed(2)} kr/kWh</title></rect><text x={xx + barW/2} y={height-9} textAnchor="middle" className="display-price-axis">{new Intl.DateTimeFormat("da-DK", { hour: "2-digit" }).format(new Date(bar.start))}</text></g>; })}
    </svg>
  </div>;
}

function UsageChart({ envelope }: { envelope: CachedEnvelope<UsageData> | null }) {
  const days = envelope?.data.days.slice(-7) ?? [];
  if (!envelope || days.length === 0) return <div className="display-empty">Elforbrug er ikke konfigureret endnu</div>;
  const max = Math.max(...days.map((day) => day.kwh), 1);
  return <div className="usage-bars" aria-label="Elforbrug sidste 7 dage">{days.map((day) => <div className="usage-bar-item" key={day.date}><strong>{day.kwh.toFixed(1)}</strong><div className="usage-bar-track"><span style={{ height: `${Math.max(5, (day.kwh / max) * 100)}%` }} /></div><small>{shortDate(day.date)}</small></div>)}</div>;
}

export default function KitchenDisplay({ theme, onToggleTheme }: Props) {
  const [data, setData] = useState<KitchenData>({ prices: null, usage: null, weather: null, status: null, bands: DEFAULT_BANDS, calendar: null, melcloud: null });
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const [prices, usage, weather, status, settings, calendar, melcloud] = await Promise.all([
          fetchJson<CachedEnvelope<EnergyPriceData>>("/api/sources/energy/prices"), fetchJson<CachedEnvelope<UsageData>>("/api/sources/energy/usage"),
          fetchJson<CachedEnvelope<WeatherData>>("/api/sources/weather"), fetchJson<SourceStatus>("/api/sources/status"), fetchJson<SettingsResponse>("/api/settings"),
          fetchJson<CalendarResponse>("/api/calendar/events?days=90"), fetchJson<MelCloudResponse>("/api/melcloud/devices"),
        ]);
        const low = Number(settings?.settings.energyLowPriceDkk ?? DEFAULT_BANDS.low), high = Number(settings?.settings.energyHighPriceDkk ?? DEFAULT_BANDS.high);
        const bands = Number.isFinite(low) && Number.isFinite(high) && low >= 0 && high > low ? { low, high } : DEFAULT_BANDS;
        if (!cancelled) { setData({ prices, usage, weather, status, bands, calendar, melcloud }); setLastRefresh(new Date()); setError(false); }
      } catch { if (!cancelled) setError(true); } finally { if (!cancelled) setLoading(false); }
    }
    void refresh();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { cancelled = true; window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, []);

  const currentPrice = data.prices?.data.intervals.find((point, index, all) => { const t = new Date(point.timeUtc).getTime(); const next = all[index + 1] ? new Date(all[index + 1].timeUtc).getTime() : t + 15 * 60 * 1000; return Date.now() >= t && Date.now() < next; });
  const currentWeather = data.weather?.data.current;
  const waste = nextWaste(data.calendar?.events ?? []);
  const pump = data.melcloud?.devices?.[0] ?? null;

  return <div className="kitchen-display">
    <header className="display-header"><div><span className="display-brand">NEXUS</span><h1>Køkken</h1></div><div className="display-header-right"><button className="theme-toggle display-theme-toggle" onClick={onToggleTheme} aria-label="Skift tema">{theme === "light" ? "☾" : "☀"}</button><div className="display-clock"><strong>{new Intl.DateTimeFormat("da-DK", { hour: "2-digit", minute: "2-digit" }).format(new Date())}</strong><span>{new Intl.DateTimeFormat("da-DK", { weekday: "long", day: "numeric", month: "long" }).format(new Date())}</span></div></div></header>
    {error && <div className="display-alert">Kunne ikke opdatere alle kilder. Viser seneste kendte data.</div>}
    <main className="display-grid">
      <section className="display-card display-card--wide"><div className="display-card-header"><div><span className="display-kicker">Strøm</span><h2>Samlet pris næste 24 timer</h2></div><span className={`freshness ${data.prices?.stale ? "stale" : ""}`}>{data.prices?.stale ? "Forsinket" : `Opdateret ${ageLabel(data.prices?.fetchedAt)}`}</span></div>{loading ? <div className="display-empty">Henter priser…</div> : <PriceChart envelope={data.prices} bands={data.bands} />}</section>
      <section className="display-card"><div className="display-card-header"><div><span className="display-kicker">Forbrug</span><h2>Sidste 7 dage</h2></div><span className={`freshness ${data.usage?.stale ? "stale" : ""}`}>{data.usage ? `Opdateret ${ageLabel(data.usage.fetchedAt)}` : "Ikke klar"}</span></div>{loading ? <div className="display-empty">Henter forbrug…</div> : <UsageChart envelope={data.usage} />}</section>
      <section className="display-card display-card--compact"><span className="display-kicker">Lige nu</span><div className="display-big-number">{currentPrice ? `${currentPrice.approxDkkPerKwh.toFixed(2)} kr` : "—"}</div><p>pr. kWh inkl. moms, net og afgifter</p></section>
      <section className="display-card display-card--compact"><span className="display-kicker">Affald</span><div className="display-big-number display-big-number--text">{waste ? wasteDateLabel(waste) : "Ingen tømning"}</div><p>{waste ? waste.title : "Ingen match i kalenderen de næste 90 dage."}</p></section>
      <section className="display-card display-card--compact"><span className="display-kicker">Vejr · {data.weather?.data.location.label ?? "Hjem"}</span><div className="display-big-number display-big-number--text">{currentWeather ? `${weatherIcon(currentWeather.symbol)} ${Math.round(currentWeather.temperature)}°C` : "Ikke klar"}</div><p>{currentWeather ? `${weatherDescription(currentWeather.symbol)} · opdateret ${ageLabel(data.weather?.fetchedAt)}` : "Venter på MET Norway."}</p></section>
      <section className="display-card display-card--compact"><span className="display-kicker">Varmepumpe</span><div className="display-big-number display-big-number--text">{pump ? heatPumpState(pump) : "Ikke klar"}</div>{pump ? <p>{pump.zone1Name ?? "Gulvvarme"} {temp(pump.roomTemperatureZone1 ?? pump.roomTemperature)} · Tank {temp(pump.tankTemperature)} / {temp(pump.setTankTemperature)} · Ude {temp(pump.outdoorTemperature)}</p> : <p>Venter på MELCloud.</p>}</section>
    </main>
    <footer className="display-footer"><span>Nexus display · auto-refresh hvert minut</span><span>{lastRefresh ? `Sidst hentet ${lastRefresh.toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "Venter på første opdatering"}</span></footer>
  </div>;
}
