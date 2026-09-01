import { useMemo } from "react";
import { useCachedJson } from "../data/queryCache";

type EnergyPoint = {
  timeUtc: string;
  totalDkkPerKwh: number | null;
  approxDkkPerKwh: number;
};

type EnergyResponse = { data: { intervals: EnergyPoint[] } };
type EnergySettingsResponse = { settings: { energyLowPriceDkk: number | null; energyHighPriceDkk: number | null } };
type PriceBands = { low: number; high: number };

type GarminHealthRow = {
  date: string;
  steps: number | null;
  step_goal: number | null;
};

type GarminHealthResponse = { history: GarminHealthRow[] };

type GarminSleepRow = {
  date: string;
  sleep_seconds: number | null;
};

type GarminSleepResponse = { history: GarminSleepRow[] };

type WeatherResponse = {
  data: {
    hourly: Array<{
      time: string;
      temperature: number;
      symbol: string | null;
      precipitationMm: number | null;
      windSpeed: number | null;
      windDirection: number | null;
    }>;
    daily: Array<{
      date: string;
      minTemperature: number;
      maxTemperature: number;
      symbol: string | null;
      precipitationMm: number | null;
      maxPrecipitationProbability: number | null;
      windSpeed: number | null;
      windDirection: number | null;
    }>;
  };
};

const ENERGY_MAX = 6;
const DEFAULT_BANDS: PriceBands = { low: 1, high: 2 };
const TZ = "Europe/Copenhagen";

function WidgetState({ label }: { label: string }) {
  return <div className="home-widget-state">{label}</div>;
}

function localDate(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function price(point: EnergyPoint): number {
  return point.totalDkkPerKwh ?? point.approxDkkPerKwh;
}

function priceBands(settings: EnergySettingsResponse | null): PriceBands {
  const low = Number(settings?.settings.energyLowPriceDkk ?? DEFAULT_BANDS.low);
  const high = Number(settings?.settings.energyHighPriceDkk ?? DEFAULT_BANDS.high);
  return Number.isFinite(low) && Number.isFinite(high) && low >= 0 && high > low ? { low, high } : DEFAULT_BANDS;
}

function bandClass(value: number, bands: PriceBands): "low" | "medium" | "high" {
  if (value <= bands.low) return "low";
  if (value >= bands.high) return "high";
  return "medium";
}

function localHourKey(value: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false, timeZone: TZ,
  }).formatToParts(new Date(value));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}-${map.hour}`;
}

function formatHour(value: string): string {
  return new Intl.DateTimeFormat("da-DK", { hour: "2-digit", timeZone: TZ }).format(new Date(value));
}

function shortDay(value: string): string {
  return new Intl.DateTimeFormat("da-DK", { weekday: "short" }).format(new Date(`${value}T12:00:00`));
}

function weatherIcon(symbol: string | null): string {
  const value = symbol ?? "";
  if (value.includes("thunder")) return "⛈️";
  if (value.includes("snow") || value.includes("sleet")) return "❄️";
  if (value.includes("rain")) return "🌧️";
  if (value.includes("fog")) return "🌫️";
  if (value.includes("cloudy")) return "☁️";
  if (value.includes("fair") || value.includes("partlycloudy")) return "⛅";
  if (value.includes("clearsky")) return "☀️";
  return "🌡️";
}

function compassDirection(degrees: number | null | undefined): string {
  if (typeof degrees !== "number" || !Number.isFinite(degrees)) return "";
  const directions = ["N", "NNØ", "NØ", "ØNØ", "Ø", "ØSØ", "SØ", "SSØ", "S", "SSV", "SV", "VSV", "V", "VNV", "NV", "NNV"];
  const normalized = ((degrees % 360) + 360) % 360;
  return directions[Math.round(normalized / 22.5) % 16];
}

function windArrow(degrees: number | null | undefined): string {
  if (typeof degrees !== "number" || !Number.isFinite(degrees)) return "·";
  const arrows = ["↑", "↗", "→", "↘", "↓", "↙", "←", "↖"];
  const normalized = ((degrees % 360) + 360) % 360;
  return arrows[Math.round(normalized / 45) % 8];
}

function windLabel(speed: number | null | undefined, direction: number | null | undefined): string {
  if (typeof speed !== "number" || !Number.isFinite(speed)) return "—";
  const compass = compassDirection(direction);
  return `${speed.toFixed(1)} m/s${compass ? ` ${compass}` : ""}`;
}

function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function hours(seconds: number | null): string {
  if (!seconds || seconds <= 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h} t ${m} min`;
}

export function EnergyPriceChartWidget() {
  const { data, loading, error } = useCachedJson<EnergyResponse>("/api/sources/energy/prices", 10 * 60_000);
  const { data: settings } = useCachedJson<EnergySettingsResponse>("/api/settings", 10 * 60_000);
  const bands = priceBands(settings);
  const bars = useMemo(() => {
    if (!data) return [];
    const now = Date.now();
    const future = data.data.intervals.filter((point) => {
      const time = Date.parse(point.timeUtc);
      return time >= now - 15 * 60_000 && time <= now + 24 * 60 * 60_000;
    });
    const grouped = new Map<string, EnergyPoint[]>();
    for (const point of future) {
      const key = localHourKey(point.timeUtc);
      const list = grouped.get(key) ?? [];
      list.push(point);
      grouped.set(key, list);
    }
    return [...grouped.values()].map((items) => ({
      time: items[0].timeUtc,
      value: items.reduce((sum, item) => sum + price(item), 0) / items.length,
    })).slice(0, 24);
  }, [data]);

  if (loading) return <WidgetState label="Henter elprisgraf…" />;
  if (error || bars.length === 0) return <WidgetState label="Elprisgraf kunne ikke hentes" />;

  const width = 720, height = 180, left = 34, right = 8, top = 10, bottom = 28;
  const plotW = width - left - right, plotH = height - top - bottom;
  const slot = plotW / bars.length;
  const barWidth = Math.max(5, slot * .68);
  const y = (value: number) => top + (1 - Math.max(0, Math.min(ENERGY_MAX, value)) / ENERGY_MAX) * plotH;
  const labelEvery = Math.max(1, Math.ceil(bars.length / 6));
  const values = bars.map((bar) => bar.value);
  const min = Math.min(...values), max = Math.max(...values);

  return <div className="home-mini-chart-block">
    <div className="home-mini-chart-summary"><span>Lavest <strong>{min.toFixed(2).replace(".", ",")} kr</strong></span><span>Højest <strong>{max.toFixed(2).replace(".", ",")} kr</strong></span><small>Fast skala 0–6 kr/kWh</small></div>
    <svg className="home-mini-chart home-energy-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Elpris næste 24 timer, fast skala 0 til 6 kroner pr. kWh">
      {[0, 2, 4, 6].map((tick) => {
        const yy = y(tick);
        return <g key={tick}><line x1={left} x2={width-right} y1={yy} y2={yy} className="home-mini-grid" /><text x={left-6} y={yy+4} textAnchor="end" className="home-mini-axis">{tick}</text></g>;
      })}
      {bars.map((bar, index) => {
        const x = left + index * slot + (slot - barWidth) / 2;
        const yy = y(bar.value);
        const band = bandClass(bar.value, bands);
        return <g key={bar.time} className={`home-energy-bar home-energy-bar--${band}`}><rect x={x} y={yy} width={barWidth} height={Math.max(2, height-bottom-yy)} rx="3"><title>{formatHour(bar.time)} · {bar.value.toFixed(2)} kr/kWh · {band === "low" ? "lav" : band === "high" ? "høj" : "middel"}</title></rect>{index % labelEvery === 0 && <text x={x+barWidth/2} y={height-8} textAnchor="middle" className="home-mini-axis">{formatHour(bar.time)}</text>}</g>;
      })}
    </svg>
  </div>;
}

export function EnergyTodayRangeWidget() {
  const { data, loading, error } = useCachedJson<EnergyResponse>("/api/sources/energy/prices", 10 * 60_000);
  const stats = useMemo(() => {
    if (!data) return null;
    const today = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: TZ }).format(new Date());
    const points = data.data.intervals.filter((point) => {
      const key = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: TZ }).format(new Date(point.timeUtc));
      return key === today;
    });
    const values = points.map(price);
    if (!values.length) return null;
    return { min: Math.min(...values), max: Math.max(...values), avg: average(values)! };
  }, [data]);
  if (loading) return <WidgetState label="Henter dagens elpriser…" />;
  if (error || !stats) return <WidgetState label="Ingen priser for i dag" />;
  return <div className="home-three-stats"><div><span>Laveste</span><strong>{stats.min.toFixed(2).replace(".", ",")}</strong></div><div><span>Gns.</span><strong>{stats.avg.toFixed(2).replace(".", ",")}</strong></div><div><span>Højeste</span><strong>{stats.max.toFixed(2).replace(".", ",")}</strong></div><small>kr/kWh i dag</small></div>;
}

export function GarminStepsWeekWidget() {
  const url = `/api/garmin/health?date=${localDate()}&days=7`;
  const { data, loading, error } = useCachedJson<GarminHealthResponse>(url, 5 * 60_000);
  if (loading) return <WidgetState label="Henter skridt for 7 dage…" />;
  const rows = data?.history ?? [];
  if (error || rows.length === 0) return <WidgetState label="Ingen skridthistorik" />;
  const values = rows.map((row) => row.steps ?? 0);
  const max = Math.max(...values, 1);
  const avg = average(rows.map((row) => row.steps).filter((value): value is number => value !== null));
  return <div className="home-week-bars-block"><div className="home-week-summary"><strong>{avg === null ? "—" : Math.round(avg).toLocaleString("da-DK")}</strong><span>gns. skridt · 7 dage</span></div><div className="home-week-bars">{rows.map((row) => <div key={row.date}><span style={{ height: `${Math.max(4, ((row.steps ?? 0) / max) * 100)}%` }} title={`${row.steps?.toLocaleString("da-DK") ?? "—"} skridt`} /><small>{shortDay(row.date)}</small></div>)}</div></div>;
}

export function GarminSleepWeekWidget() {
  const url = `/api/garmin/sleep?date=${localDate()}&days=7`;
  const { data, loading, error } = useCachedJson<GarminSleepResponse>(url, 5 * 60_000);
  if (loading) return <WidgetState label="Henter søvn for 7 dage…" />;
  const rows = (data?.history ?? []).filter((row) => (row.sleep_seconds ?? 0) > 0);
  if (error || rows.length === 0) return <WidgetState label="Ingen søvnhistorik" />;
  const max = 12 * 3600;
  const avg = average(rows.map((row) => row.sleep_seconds!).filter((value) => Number.isFinite(value)));
  return <div className="home-week-bars-block"><div className="home-week-summary"><strong>{hours(avg)}</strong><span>gns. søvn · 7 nætter</span></div><div className="home-week-bars home-week-bars--sleep">{rows.map((row) => <div key={row.date}><span style={{ height: `${Math.max(4, Math.min(100, ((row.sleep_seconds ?? 0) / max) * 100))}%` }} title={hours(row.sleep_seconds)} /><small>{shortDay(row.date)}</small></div>)}</div></div>;
}

export function WeatherNextHoursWidget() {
  const { data, loading, error } = useCachedJson<WeatherResponse>("/api/sources/weather", 5 * 60_000);
  if (loading) return <WidgetState label="Henter timevejret…" />;
  const nextHours = data?.data.hourly?.slice(0, 6) ?? [];
  if (error || nextHours.length === 0) return <WidgetState label="Ingen timeudsigt" />;
  return <div className="home-weather-hours">{nextHours.map((hour) => <div key={hour.time}>
    <span>{new Intl.DateTimeFormat("da-DK", { hour: "2-digit", timeZone: TZ }).format(new Date(hour.time))}</span>
    <b aria-hidden="true">{weatherIcon(hour.symbol)}</b>
    <strong>{Math.round(hour.temperature)}°</strong>
    <small className="home-weather-wind">{windArrow(hour.windDirection)} {windLabel(hour.windSpeed, hour.windDirection)}</small>
    <small className="home-weather-rain">☂ {hour.precipitationMm === null ? "—" : `${hour.precipitationMm.toFixed(1)} mm`}</small>
  </div>)}</div>;
}

export function WeatherWeekWidget() {
  const { data, loading, error } = useCachedJson<WeatherResponse>("/api/sources/weather", 5 * 60_000);
  if (loading) return <WidgetState label="Henter 7-dages udsigt…" />;
  const days = data?.data.daily?.slice(0, 7) ?? [];
  if (error || days.length === 0) return <WidgetState label="Ingen 7-dages udsigt" />;
  return <div className="home-weather-week">{days.map((day) => <div key={day.date}>
    <span>{shortDay(day.date)}</span>
    <b aria-hidden="true">{weatherIcon(day.symbol)}</b>
    <strong>{Math.round(day.maxTemperature)}° <em>{Math.round(day.minTemperature)}°</em></strong>
    <small className="home-weather-wind">{windArrow(day.windDirection)} {windLabel(day.windSpeed, day.windDirection)}</small>
    <small className="home-weather-rain">☂ {day.precipitationMm === null ? "—" : `${day.precipitationMm.toFixed(1)} mm`}{day.maxPrecipitationProbability !== null ? ` · ${Math.round(day.maxPrecipitationProbability)}%` : ""}</small>
  </div>)}</div>;
}