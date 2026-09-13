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

export function integrationKeyForWidgetId(id: string): IntegrationKey | null {
  if (id.startsWith("unraid.")) return "unraid";
  if (id.startsWith("garmin.")) return "garmin";
  if (id.startsWith("wellbeing.")) return "wellbeing";
  if (id.startsWith("weather.")) return "weather";
  if (id.startsWith("energy.")) return "electricity";
  if (id.startsWith("calendar.")) return "calendar";
  if (id.startsWith("melcloud.")) return "melcloud";
  return null;
}

export function widgetIntegrationKey(widget: Pick<WidgetDefinition, "id" | "group" | "page">): IntegrationKey | null {
  const byId = integrationKeyForWidgetId(widget.id);
  if (byId) return byId;
  if (widget.group === "Unraid") return "unraid";
  if (widget.group === "Garmin") return "garmin";
  if (widget.group === "Velbefindende") return "wellbeing";
  if (widget.group === "Vejr") return "weather";
  if (widget.group === "Strøm") return "electricity";
  if (widget.group === "Kalender") return "calendar";
  if (widget.group === "MELCloud") return "melcloud";
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
