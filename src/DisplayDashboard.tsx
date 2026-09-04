import { useEffect, useState } from "react";
import WidgetCard from "./dashboard/WidgetCard";
import type { LayoutItem } from "./dashboard/layoutEditing";
import { resolveDashboardRefreshClass } from "./data/dashboardRefresh";
import { useSettings } from "./data/settings";
import { widgetDefinitionById } from "./widgets/widgetCatalog";
import { widgetRefreshGroup } from "./widgets/widgetRegistry";

type DisplayDashboardModel = {
  id: string;
  name: string;
  theme: "light" | "dark" | "system";
  layout: LayoutItem[];
};

type Props = {
  dashboard: DisplayDashboardModel;
  theme: "light" | "dark";
  onThemeChange: (theme: "light" | "dark") => void;
};

const TIME_FORMATTER = new Intl.DateTimeFormat("da-DK", { hour: "2-digit", minute: "2-digit" });
const DATE_FORMATTER = new Intl.DateTimeFormat("da-DK", { weekday: "long", day: "numeric", month: "long" });

/**
 * Paired kiosk view. No app chrome, no drill-down links, fills the screen:
 * the grid distributes the viewport height across its rows and only scrolls
 * when the layout genuinely cannot fit.
 */
export default function DisplayDashboard({ dashboard, theme, onThemeChange }: Props) {
  const { data: refreshSettings } = useSettings();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (dashboard.theme === "light" || dashboard.theme === "dark") onThemeChange(dashboard.theme);
  }, [dashboard.id, dashboard.theme, onThemeChange]);

  useEffect(() => {
    let interval: number | undefined;
    const updateClock = () => setNow(new Date());
    const msUntilNextMinute = 60_000 - (Date.now() % 60_000) + 50;
    const timeout = window.setTimeout(() => {
      updateClock();
      interval = window.setInterval(updateClock, 60_000);
    }, msUntilNextMinute);

    return () => {
      window.clearTimeout(timeout);
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, []);

  return <div className="display-dashboard-shell">
    <header className="display-dashboard-header">
      <div className="display-dashboard-title"><span className="display-brand">NEXUS</span><h1>{dashboard.name}</h1></div>
      <div className="display-dashboard-header-actions">
        <div className="display-clock"><strong>{TIME_FORMATTER.format(now)}</strong><span>{DATE_FORMATTER.format(now)}</span></div>
        <button className="theme-toggle display-theme-toggle" type="button" onClick={() => onThemeChange(theme === "light" ? "dark" : "light")} aria-label="Skift tema">{theme === "light" ? "☾" : "☀"}</button>
      </div>
    </header>

    {dashboard.layout.length === 0 ? <div className="home-empty"><strong>Displayet er tomt.</strong><span>Tilføj widgets fra Displays i Nexus.</span></div> :
      <main className="home-widget-grid display-dashboard-grid">
        {dashboard.layout.map((item) => {
          const widget = widgetDefinitionById(item.id);
          if (!widget) return null;
          const Widget = widget.component;
          const refreshClass = resolveDashboardRefreshClass(widgetRefreshGroup(widget), refreshSettings);
          return <WidgetCard key={item.id} id={item.id} title={widget.title} size={item.size} rows={widget.rows} refreshClass={refreshClass}><Widget /></WidgetCard>;
        })}
      </main>}
  </div>;
}
