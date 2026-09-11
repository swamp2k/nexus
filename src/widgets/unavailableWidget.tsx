import type { WidgetDefinition } from "./widgetRegistry";

function UnavailableWidgetContent() {
  return <div className="home-widget-state">Indstillingerne er bevaret.</div>;
}

/** Render-only fallback: keep saved instances visible and editable during catalog changes. */
export function unavailableWidgetDefinition(id: string): WidgetDefinition {
  return {
    id,
    title: "Widget utilgængelig",
    description: "Indstillingerne er bevaret",
    group: "Andre",
    defaultSize: "medium",
    supportedSizes: [],
    component: UnavailableWidgetContent,
  };
}
