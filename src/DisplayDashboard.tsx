import { useEffect } from "react";
import { DashboardRefreshScope, resolveDashboardRefreshClass } from "./data/dashboardRefresh";
import type { DashboardRefreshSettingsResponse } from "./data/dashboardRefresh";
import { useCachedJson } from "./data/queryCache";
import { widgetById } from "./widgets/widgetRegistry";
import type { WidgetSize } from "./widgets/widgetRegistry";

type DisplayDashboardModel = {
  id: string;
  name: string;
  theme: "light" | "dark" | "system";
  layout: Array<{ id: string; size: WidgetSize }>;
};

type Props = {
  dashboard: DisplayDashboardModel;
  theme: "light" | "dark";
  onThemeChange: (theme: "light" | "dark") => void;
};

export default function DisplayDashboard({ dashboard, theme, onThemeChange }: Props) {
  const { data: refreshSettings } = useCachedJson<DashboardRefreshSettingsResponse>("/api/settings", 1_000);

  useEffect(() => {
    if (dashboard.theme === "light" || dashboard.theme === "dark") onThemeChange(dashboard.theme);
  }, [dashboard.id]);

  return <div className="display-dashboard-shell">
    <header className="display-dashboard-header">
      <div><span className="display-brand">NEXUS DISPLAY</span><h1>{dashboard.name}</h1></div>
      <div className="display-dashboard-header-actions">
        <div className="display-clock"><strong>{new Intl.DateTimeFormat("da-DK", { hour: "2-digit", minute: "2-digit" }).format(new Date())}</strong><span>{new Intl.DateTimeFormat("da-DK", { weekday: "long", day: "numeric", month: "long" }).format(new Date())}</span></div>
        <button className="theme-toggle" type="button" onClick={() => onThemeChange(theme === "light" ? "dark" : "light")} aria-label="Skift tema">{theme === "light" ? "☾" : "☀"}</button>
      </div>
    </header>

    {dashboard.layout.length === 0 ? <div className="home-empty"><strong>Displayet er tomt.</strong><span>Tilføj widgets fra Displays i Nexus.</span></div> :
      <main className="home-widget-grid display-dashboard-grid">
        {dashboard.layout.map((item) => {
          const widget = widgetById.get(item.id);
          if (!widget) return null;
          const Widget = widget.component;
          const refreshClass = resolveDashboardRefreshClass(widget.group, refreshSettings);
          return <article className={`home-widget home-widget--${item.size}`} data-widget-id={item.id} data-refresh-class={refreshClass} key={item.id}>
            <header><div><span>{widget.group}</span><h3>{widget.title}</h3></div></header>
            <div className="home-widget-content"><DashboardRefreshScope refreshClass={refreshClass}><Widget /></DashboardRefreshScope></div>
          </article>;
        })}
      </main>}
  </div>;
}
