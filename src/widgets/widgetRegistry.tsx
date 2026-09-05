import type { ComponentType } from "react";
import { useMemo } from "react";
import { useDashboardJson } from "../data/dashboardRefresh";
import type { EnergyPricesResponse, WeatherResponse } from "../data/api-types";
import CalendarWasteWidget from "./CalendarWasteWidget";
import MelCloudWidget from "./MelCloudWidget";
import {
  EnergyPriceChartWidget,
  EnergyTodayRangeWidget,
  GarminSleepWeekWidget,
  GarminStepsWeekWidget,
  WeatherNextHoursWidget,
  WeatherWeekWidget,
} from "./extendedWidgets";

export type WidgetSize = "small" | "medium" | "wide";
export type WidgetSurface = "home" | "display";
export type WidgetTargetPage = "Garmin" | "Velbefindende" | "Vejr" | "Strøm" | "Kalender" | "Varmepumpe" | "Unraid" | "DBA" | "PC Watch" | "Motion";

export type WidgetRuntimeProps = {
  config?: Record<string, unknown>;
};

export type WidgetDefinition = {
  id: string;
  title: string;
  description: string;
  /** Source/module label shown in the editor catalogue. */
  group: string;
  /** Key used to look up the refresh class in settings. Defaults to `group`. */
  refreshGroup?: string;
  /** Optional drill-down page. Utility widgets can omit this. */
  page?: WidgetTargetPage;
  /** Repeatable definitions create stable instances with `type` + per-instance config. */
  repeatable?: boolean;
  /** Resolve a per-instance card title from config. */
  resolveTitle?: (config?: Record<string, unknown>) => string;
  /** Surfaces where this widget is safe to offer. Defaults to Home only. */
  surfaces?: WidgetSurface[];
  defaultSize: WidgetSize;
  supportedSizes: WidgetSize[];
  /** Grid rows the card claims on desktop. 2 for charts and lists; 1 (default) for numbers. */
  rows?: 1 | 2;
  component: ComponentType<WidgetRuntimeProps>;
};

export function widgetRefreshGroup(widget: Pick<WidgetDefinition, "group" | "refreshGroup">): string {
  return widget.refreshGroup ?? widget.group;
}

export function widgetSupportsSurface(widget: Pick<WidgetDefinition, "surfaces">, surface: WidgetSurface): boolean {
  return (widget.surfaces ?? ["home"]).includes(surface);
}

type GarminOverview = {
  daily: Record<string, unknown> | null;
  sleep: Record<string, unknown> | null;
};


type WellbeingResponse = {
  metrics: Array<{ id: string; name: string; emoji: string; valueType: "scale" | "boolean" }>;
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
  const { data, loading, error } = useDashboardJson<GarminOverview>("/api/garmin/overview");
  if (loading) return <WidgetState label="Henter skridt…" />;
  if (error || !data?.daily) return <WidgetState label="Ingen Garmin-data" />;
  const steps = numberValue(data.daily, "steps");
  const goal = numberValue(data.daily, "step_goal");
  const progress = steps !== null && goal && goal > 0 ? Math.min(100, Math.round((steps / goal) * 100)) : null;
  return <div className="home-metric"><strong>{steps?.toLocaleString("da-DK") ?? "—"}</strong><span>skridt i dag</span>{goal !== null && <small>Mål {goal.toLocaleString("da-DK")}{progress !== null ? ` · ${progress}%` : ""}</small>}</div>;
}

function GarminSleepWidget() {
  const { data, loading, error } = useDashboardJson<GarminOverview>("/api/garmin/overview");
  if (loading) return <WidgetState label="Henter søvn…" />;
  if (error || !data?.sleep) return <WidgetState label="Ingen søvndata" />;
  return <div className="home-metric"><strong>{hours(data.sleep.sleep_seconds)}</strong><span>sidste nat</span><small>Dyb {hours(data.sleep.deep_seconds)} · REM {hours(data.sleep.rem_seconds)}</small></div>;
}

function GarminBodyBatteryWidget() {
  const { data, loading, error } = useDashboardJson<GarminOverview>("/api/garmin/overview");
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
  const { data, loading, error } = useDashboardJson<WeatherResponse>("/api/sources/weather");
  if (loading) return <WidgetState label="Henter vejret…" />;
  if (error || !data?.data.current) return <WidgetState label="Vejret kunne ikke hentes" />;
  const current = data.data.current;
  const wind = current.windSpeed === null ? "—" : `${current.windSpeed.toFixed(1)} m/s ${compassDirection(current.windDirection)}`.trim();
  const precipitation = current.precipitationMm === null ? "—" : `${current.precipitationMm.toFixed(1)} mm`;
  return <div className="home-weather"><span className="home-weather-icon" aria-hidden="true">{weatherIcon(current.symbol)}</span><div><strong>{Math.round(current.temperature)}°</strong><span>{data.data.location.label}</span><small className="home-weather-details"><span>Vind {wind}</span><span>Nedbør {precipitation}</span></small></div></div>;
}

function EnergyCurrentWidget() {
  const { data, loading, error } = useDashboardJson<EnergyPricesResponse>("/api/sources/energy/prices");
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
  const { data, loading, error } = useDashboardJson<WellbeingResponse>(url);
  if (loading) return <WidgetState label="Henter dagens check-in…" />;
  if (error || !data) return <WidgetState label="Check-in kunne ikke hentes" />;
  const values = new Map(data.entries.map((entry) => [entry.metricId, entry.value]));
  if (data.entries.length === 0) return <WidgetState label="Ingen check-in endnu i dag" />;
  const completed = data.metrics.filter((metric) => values.has(metric.id));
  const journal = data.journals[0]?.body?.trim() ?? "";
  return <div className="home-wellbeing">
    <div className="home-wellbeing-summary"><strong>{completed.length} af {data.metrics.length}</strong><span>målepunkter registreret i dag</span></div>
    <div className="home-wellbeing-metrics">{completed.map((metric) => {
      const value = values.get(metric.id);
      return <span key={metric.id}>{metric.emoji} {metric.name}: <strong>{metric.valueType === "boolean" ? (value === 1 ? "Ja" : "Nej") : `${value}/5`}</strong></span>;
    })}</div>
    {journal ? <div className="home-wellbeing-journal"><span>Journal</span><p>{journal}</p></div> : <small className="home-wellbeing-no-journal">Ingen journalnote i dag</small>}
  </div>;
}

const FLEX_SIZES: WidgetSize[] = ["small", "medium", "wide"];

export const widgetRegistry: WidgetDefinition[] = [
  { id: "garmin.steps.today", title: "Skridt", description: "Skridt og dagens mål", group: "Garmin", page: "Garmin", defaultSize: "small", supportedSizes: ["small", "medium"], component: GarminStepsWidget },
  { id: "garmin.steps.week", rows: 2, title: "Skridt · 7 dage", description: "Daglige skridt og 7-dages gennemsnit", group: "Garmin", page: "Garmin", defaultSize: "medium", supportedSizes: FLEX_SIZES, component: GarminStepsWeekWidget },
  { id: "garmin.sleep.lastNight", title: "Søvn", description: "Seneste nats søvn", group: "Garmin", page: "Garmin", defaultSize: "small", supportedSizes: ["small", "medium"], component: GarminSleepWidget },
  { id: "garmin.sleep.week", rows: 2, title: "Søvn · 7 dage", description: "Søvnvarighed de seneste 7 nætter", group: "Garmin", page: "Garmin", defaultSize: "medium", supportedSizes: FLEX_SIZES, component: GarminSleepWeekWidget },
  { id: "garmin.bodyBattery.today", title: "Body Battery", description: "Seneste Body Battery", group: "Garmin", page: "Garmin", defaultSize: "small", supportedSizes: ["small", "medium"], component: GarminBodyBatteryWidget },
  { id: "energy.price.current", title: "Elpris", description: "Samlet pris lige nu", group: "Strøm", page: "Strøm", surfaces: ["home", "display"], defaultSize: "small", supportedSizes: ["small", "medium"], component: EnergyCurrentWidget },
  { id: "energy.price.todayRange", title: "Elpris · i dag", description: "Laveste, gennemsnit og højeste pris i dag", group: "Strøm", page: "Strøm", surfaces: ["home", "display"], defaultSize: "small", supportedSizes: FLEX_SIZES, component: EnergyTodayRangeWidget },
  { id: "energy.price.next24h", rows: 2, title: "Elpris · næste døgn", description: "Prisgraf for de næste 24 timer", group: "Strøm", page: "Strøm", surfaces: ["home", "display"], defaultSize: "medium", supportedSizes: FLEX_SIZES, component: EnergyPriceChartWidget },
  { id: "weather.current", title: "Vejr", description: "Vejret lige nu", group: "Vejr", page: "Vejr", surfaces: ["home", "display"], defaultSize: "medium", supportedSizes: ["small", "medium"], component: WeatherCurrentWidget },
  { id: "weather.nextHours", title: "Vejr · næste timer", description: "Temperatur, vind og nedbør de næste timer", group: "Vejr", page: "Vejr", surfaces: ["home", "display"], defaultSize: "medium", supportedSizes: FLEX_SIZES, component: WeatherNextHoursWidget },
  { id: "weather.week", title: "Vejr · 7 dage", description: "Kort 7-dages vejrudsigt", group: "Vejr", page: "Vejr", surfaces: ["home", "display"], defaultSize: "medium", supportedSizes: FLEX_SIZES, component: WeatherWeekWidget },
  { id: "calendar.waste.next", rows: 2, title: "Affald", description: "Næste tømning af rest, plast og papir", group: "Kalender", page: "Kalender", surfaces: ["home", "display"], defaultSize: "medium", supportedSizes: FLEX_SIZES, component: CalendarWasteWidget },
  { id: "melcloud.atw.current", title: "Varmepumpe", description: "Rum, tank, ude og driftsstatus", group: "MELCloud", page: "Varmepumpe", surfaces: ["home", "display"], defaultSize: "medium", supportedSizes: FLEX_SIZES, component: MelCloudWidget },
  { id: "wellbeing.today", rows: 2, title: "Velbefindende", description: "Dagens check-in og journal", group: "Velbefindende", page: "Velbefindende", defaultSize: "medium", supportedSizes: FLEX_SIZES, component: WellbeingTodayWidget },
];

export const widgetById = new Map(widgetRegistry.map((widget) => [widget.id, widget]));
