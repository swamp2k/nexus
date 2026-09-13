import type { WidgetDefinition, WidgetTargetPage } from "../widgets/widgetRegistry";

export type IntegrationKey = "garmin" | "wellbeing" | "weather" | "electricity" | "calendar" | "melcloud" | "dba" | "unraid" | "pcwatch" | "notifications" | "displays";
export type IntegrationMap = Record<IntegrationKey, boolean>;

export const DEFAULT_INTEGRATIONS: IntegrationMap = {
  garmin: true,
  wellbeing: true,
  weather: true,
  electricity: true,
  calendar: true,
  melcloud: true,
  dba: true,
  unraid: true,
  pcwatch: true,
  notifications: true,
  displays: true,
};

export const PAGE_INTEGRATION: Partial<Record<WidgetTargetPage | "Displays", IntegrationKey>> = {
  Garmin: "garmin",
  Motion: "garmin",
  Velbefindende: "wellbeing",
  Vejr: "weather",
  Strøm: "electricity",
  Kalender: "calendar",
  Varmepumpe: "melcloud",
  DBA: "dba",
  Unraid: "unraid",
  "PC Watch": "pcwatch",
  Displays: "displays",
};

export function integrationEnabled(key: IntegrationKey, integrations: IntegrationMap): boolean {
  return integrations[key] !== false;
}

export function pageIntegrationEnabled(page: WidgetTargetPage | "Displays", integrations: IntegrationMap): boolean {
  const key = PAGE_INTEGRATION[page];
  return !key || integrationEnabled(key, integrations);
}

export function widgetIntegrationKey(widget: Pick<WidgetDefinition, "id" | "group" | "page">): IntegrationKey | null {
  if (widget.id.startsWith("unraid.") || widget.group === "Unraid") return "unraid";
  if (widget.id.startsWith("garmin.") || widget.group === "Garmin") return "garmin";
  if (widget.id.startsWith("wellbeing.") || widget.group === "Velbefindende") return "wellbeing";
  if (widget.id.startsWith("weather.") || widget.group === "Vejr") return "weather";
  if (widget.id.startsWith("energy.") || widget.group === "Strøm") return "electricity";
  if (widget.id.startsWith("calendar.") || widget.group === "Kalender") return "calendar";
  if (widget.id.startsWith("melcloud.") || widget.group === "MELCloud") return "melcloud";
  if (widget.page) return PAGE_INTEGRATION[widget.page] ?? null;
  return null;
}

export function widgetIntegrationEnabled(widget: Pick<WidgetDefinition, "id" | "group" | "page">, integrations: IntegrationMap): boolean {
  const key = widgetIntegrationKey(widget);
  return !key || integrationEnabled(key, integrations);
}

export async function fetchIntegrations(): Promise<IntegrationMap> {
  const response = await fetch("/api/integrations", { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json() as { integrations: IntegrationMap };
  return { ...DEFAULT_INTEGRATIONS, ...body.integrations };
}
