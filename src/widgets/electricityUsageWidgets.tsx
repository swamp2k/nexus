import { useMemo } from "react";
import { useDashboardJson } from "../data/dashboardRefresh";
import type { WidgetDefinition } from "./widgetRegistry";

type UsageDay = {
  date: string;
  kwh: number;
};

type ElectricityUsageResponse = {
  data: {
    source: "Eloverblik";
    days: UsageDay[];
  };
  fetchedAt: string;
  stale: boolean;
};

function WidgetState({ label }: { label: string }) {
  return <div className="home-widget-state">{label}</div>;
}

function shortDay(value: string): string {
  return new Intl.DateTimeFormat("da-DK", { weekday: "short" }).format(new Date(`${value}T12:00:00`));
}

function ElectricityUsageWeekWidget() {
  const { data, loading, error } = useDashboardJson<ElectricityUsageResponse>("/api/sources/energy/usage");
  const stats = useMemo(() => {
    const rows = (data?.data.days ?? []).filter((row) => Number.isFinite(row.kwh) && row.kwh >= 0).slice(-7);
    if (rows.length === 0) return null;

    const latest = rows[rows.length - 1];
    const average = rows.reduce((sum, row) => sum + row.kwh, 0) / rows.length;
    const max = Math.max(...rows.map((row) => row.kwh), 1);

    return { rows, latest, average, max };
  }, [data]);

  if (loading) return <WidgetState label="Henter elforbrug…" />;
  if (error || !stats) return <WidgetState label="Elforbruget kunne ikke hentes" />;

  return (
    <div className="home-week-bars-block">
      <div className="home-week-summary">
        <strong>{stats.latest.kwh.toFixed(1).replace(".", ",")} kWh</strong>
        <span>seneste registrerede døgn</span>
        <small>7-dages gns. {stats.average.toFixed(1).replace(".", ",")} kWh</small>
      </div>
      <div className="home-week-bars">
        {stats.rows.map((row) => (
          <div key={row.date}>
            <span
              style={{ height: `${Math.max(4, (row.kwh / stats.max) * 100)}%` }}
              title={`${row.kwh.toFixed(2).replace(".", ",")} kWh`}
            />
            <small>{shortDay(row.date)}</small>
          </div>
        ))}
      </div>
      {data?.stale && <small>Viser seneste kendte Eloverblik-data</small>}
    </div>
  );
}

export const electricityUsageWidgetDefinitions: WidgetDefinition[] = [
  {
    id: "energy.usage.week",
    title: "Elforbrug · 7 dage",
    description: "Seneste døgn, 7-dages gennemsnit og dagligt forbrug",
    group: "Strøm",
    page: "Strøm",
    defaultSize: "medium",
    supportedSizes: ["medium", "wide"],
    component: ElectricityUsageWeekWidget,
  },
];
