import type { ComponentType } from "react";
import { useMemo } from "react";
import { useCachedJson } from "../data/queryCache";

export type WidgetSize = "small" | "medium" | "wide";
export type WidgetTargetPage = "Garmin" | "Velbefindende" | "Vejr" | "Strøm" | "Unraid" | "DBA" | "PC Watch" | "Motion";

export type WidgetDefinition = {
  id: string;
  title: string;
  description: string;
  group: string;
  page: WidgetTargetPage;
  defaultSize: WidgetSize;
  supportedSizes: WidgetSize[];
  component: ComponentType;
};

type GarminOverview = {
  daily: Record<string, unknown> | null;
  sleep: Record<string, unknown> | null;
};

type WeatherResponse = {
  data: {
    location: { label: string };
    current: {
      temperature: number;
      windSpeed: number | null;
      windDirection: number | null;
      symbol: string | null;
    };
  };
};

type EnergyPoint = {
  timeUtc: string;
  totalDkkPerKwh: number | null;
  approxDkkPerKwh: number;
};

type EnergyResponse = { data: { intervals: EnergyPoint[] } };

type WellbeingResponse = {
  metrics: Array<{ id: string; name: string; emoji: string }>;
  entries: Array<{ metricId: string; value: number }>;
  journals: Array<{ body: string }>;
};

function numberValue(row: Record<string, unknown> | null | undefined, key: string): number | null {
  const value = row?.[key];
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function hours(seconds: unknown): string {
  const value = typeof seconds === "number" ? seconds : Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return "—";
  const h = Math.floor(value / 3600);
  const m = Math.round((value % 3600) / 60);
  return `${h} t ${m} min`;
}

function WidgetState({ label }: { label: string }) {
  return <div className="home-widget-state">{label}</div>;
}

function GarminStepsWidget() {
  const { data, loading, error } = useCachedJson<GarminOverview>("/api/garmin/overview", 5 * 60_000);
  if (loading) return <WidgetState label="Henter skridt…" />;
  if (error || !data?.daily) return <WidgetState label="Ingen Garmin-data" />;
  const steps = numberValue(data.daily, "steps");
  const goal = numberValue(data.daily, "step_goal");
  const progress = steps !== null && goal && goal > 0 ? Math.min(100, Math.round((steps / goal) * 100)) : null;
  return <div className="home-metric"><strong>{steps?.toLocaleString("da-DK") ?? "—"}</strong><span>skridt i dag</span>{goal !== null && <small>Mål {goal.toLocaleString("da-DK")}{progress !== null ? ` · ${progress}%` : ""}</small>}</div>;
}

function GarminSleepWidget() {
  const { data, loading, error } = useCachedJson<GarminOverview>("/api/garmin/overview", 5 * 60_000);
  if (loading) return <WidgetState label="Henter søvn…" />;
  if (error || !data?.sleep) return <WidgetState label="Ingen søvndata" />;
  return <div className="home-metric"><strong>{hours(data.sleep.sleep_seconds)}</strong><span>sidste nat</span><small>Dyb {hours(data.sleep.deep_seconds)} · REM {hours(data.sleep.rem_seconds)}</small></div>;
}

function GarminBodyBatteryWidget() {
  const { data, loading, error } = useCachedJson<GarminOverview>("/api/garmin/overview", 5 * 60_000);
  if (loading) return <WidgetState label="Henter Body Battery…" />;
  if (error || !data?.daily) return <WidgetState label="Ingen Garmin-data" />;
  const latest = numberValue(data.daily, "body_battery_latest");
  const low = numberValue(data.daily, "body_battery_low");
  const high = numberValue(data.daily, "body_battery_high");
  return <div className="home-metric"><strong>{latest ?? "—"}</strong><span>Body Battery</span><small>{low ?? "—"} → {high ?? "—"} i dag</small></div>;
}

function weatherIcon(symbol: string | null): string {
  const value = symbol ?? "";
  if (value.includes("thunder")) return "⛈️";
  if (value.includes("snow") || value.includes("sleet")) return "❄️";
  if (value.includes("rain")) return "🌧️";
  if (value.includes("cloudy")) return "☁️";
  if (value.includes("fair") || value.includes("partlycloudy")) return "⛅";
  if (value.includes("clearsky")) return "☀️";
  return "🌡️";
}

function compassDirection(degrees: number | null): string {
  if (typeof degrees !== "number" || !Number.isFinite(degrees)) return "";
  const directions = ["N", "NNØ", "NØ", "ØNØ", "Ø", "ØSØ", "SØ", "SSØ", "S", "SSV", "SV", "VSV", "V", "VNV", "NV", "NNV"];
  const normalized = ((degrees % 360) + 360) % 360;
  return directions[Math.round(normalized / 22.5) % 16];
}

function WeatherCurrentWidget() {
  const { data, loading, error } = useCachedJson<WeatherResponse>("/api/sources/weather", 5 * 60_000);
  if (loading) return <WidgetState label="Henter vejret…" />;
  if (error || !data?.data.current) return <WidgetState label="Vejret kunne ikke hentes" />;
  const current = data.data.current;
  const wind = current.windSpeed === null ? "—" : `${current.windSpeed.toFixed(1)} m/s ${compassDirection(current.windDirection)}`.trim();
  return <div className="home-weather"><span className="home-weather-icon" aria-hidden="true">{weatherIcon(current.symbol)}</span><div><strong>{Math.round(current.temperature)}°</strong><span>{data.data.location.label}</span><small>Vind {wind}</small></div></div>;
}

function EnergyCurrentWidget() {
  const { data, loading, error } = useCachedJson<EnergyResponse>("/api/sources/energy/prices", 10 * 60_000);
  const current = useMemo(() => {
    if (!data) return null;
    const now = Date.now();
    const points = data.data.intervals;
    return points.find((point, index) => {
      const start = Date.parse(point.timeUtc);
      const next = points[index + 1] ? Date.parse(points[index + 1].timeUtc) : start + 15 * 60_000;
      return now >= start && now < next;
    }) ?? null;
  }, [data]);
  if (loading) return <WidgetState label="Henter elpris…" />;
  if (error || !current) return <WidgetState label="Elprisen kunne ikke hentes" />;
  const price = current.totalDkkPerKwh ?? current.approxDkkPerKwh;
  return <div className="home-metric"><strong>{price.toFixed(2).replace(".", ",")} kr</strong><span>pr. kWh lige nu</span><small>Samlet variabel pris</small></div>;
}

function localDate(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function WellbeingTodayWidget() {
  const url = `/api/wellbeing/day?date=${encodeURIComponent(localDate())}`;
  const { data, loading, error } = useCachedJson<WellbeingResponse>(url, 60_000);
  if (loading) return <WidgetState label="Henter dagens check-in…" />;
  if (error || !data) return <WidgetState label="Check-in kunne ikke hentes" />;
  const values = new Map(data.entries.map((entry) => [entry.metricId, entry.value]));
  if (data.entries.length === 0) return <WidgetState label="Ingen check-in endnu i dag" />;
  return <div className="home-wellbeing"><div className="home-wellbeing-metrics">{data.metrics.filter((metric) => values.has(metric.id)).map((metric) => <span key={metric.id}>{metric.emoji} {metric.name}: <strong>{values.get(metric.id)}/5</strong></span>)}</div>{data.journals[0]?.body && <p>{data.journals[0].body}</p>}</div>;
}

export const widgetRegistry: WidgetDefinition[] = [
  { id: "garmin.steps.today", title: "Skridt", description: "Skridt og dagens mål", group: "Garmin", page: "Garmin", defaultSize: "small", supportedSizes: ["small", "medium"], component: GarminStepsWidget },
  { id: "garmin.sleep.lastNight", title: "Søvn", description: "Seneste nats søvn", group: "Garmin", page: "Garmin", defaultSize: "small", supportedSizes: ["small", "medium"], component: GarminSleepWidget },
  { id: "garmin.bodyBattery.today", title: "Body Battery", description: "Seneste Body Battery", group: "Garmin", page: "Garmin", defaultSize: "small", supportedSizes: ["small", "medium"], component: GarminBodyBatteryWidget },
  { id: "energy.price.current", title: "Elpris", description: "Samlet pris lige nu", group: "Strøm", page: "Strøm", defaultSize: "small", supportedSizes: ["small", "medium"], component: EnergyCurrentWidget },
  { id: "weather.current", title: "Vejr", description: "Vejret lige nu", group: "Vejr", page: "Vejr", defaultSize: "medium", supportedSizes: ["small", "medium"], component: WeatherCurrentWidget },
  { id: "wellbeing.today", title: "Velbefindende", description: "Dagens check-in og journal", group: "Velbefindende", page: "Velbefindende", defaultSize: "medium", supportedSizes: ["medium", "wide"], component: WellbeingTodayWidget },
];

export const widgetById = new Map(widgetRegistry.map((widget) => [widget.id, widget]));
