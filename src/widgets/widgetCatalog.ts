import { electricityUsageWidgetDefinitions } from "./electricityUsageWidgets";
import { widgetRegistry } from "./widgetRegistry";
import {
  dynamicUnraidWidgetDefinitions,
  resolveDynamicUnraidWidget,
  unraidWidgetDefinitions,
} from "./unraidWidgets";

export type { UnraidOverview } from "./unraidWidgets";
export { dynamicUnraidWidgetDefinitions } from "./unraidWidgets";

/** Static widgets that are always available in the Home editor. */
export const widgetCatalog = [...widgetRegistry, ...electricityUsageWidgetDefinitions, ...unraidWidgetDefinitions];
const staticWidgetById = new Map(widgetCatalog.map((widget) => [widget.id, widget]));

/**
 * Resolve both normal widgets and persisted dynamic widgets.
 * Dynamic Unraid container/VM IDs remain valid even when the server is
 * temporarily unavailable and the editor cannot discover their friendly name.
 */
export function widgetDefinitionById(id: string) {
  return staticWidgetById.get(id) ?? resolveDynamicUnraidWidget(id);
}

export function discoverUnraidWidgets(data: import("./unraidWidgets").UnraidOverview | null) {
  return dynamicUnraidWidgetDefinitions(data);
}
