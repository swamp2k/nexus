import { useMemo } from "react";
import { useDashboardJson } from "../data/dashboardRefresh";
import { useCachedJson } from "../data/queryCache";
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

type UsageSettingsResponse = {
  settings: {
    energyUsageLowKwh: number | null;
    energyUsageHighKwh: number | null;
  };
};

function WidgetState({ label }: { label: string }) {
  return <div className="home-widget-state">{label}</div>;
}

function shortDay(value: string): string {
  return new Intl.DateTimeFormat("da-DK", { weekday: "short" }).format(new Date(`${value}T12:00:00`));
}

function usageBand(value: number, low: number, high: number): "low" | "medium" | "high" {
  if (value <= low) return "low";
  if (value >= high) return "high";
  return "medium";
}

function ElectricityUsageWeekWidget() {
  const { data, loading, error } = useDashboardJson<ElectricityUsageResponse>("/api/sources/energy/usage");
  const { data: settings } = useCachedJson<UsageSettingsResponse>("/api/settings", 10 * 60_000);
  const low = Number(settings?.settings.energyUsageLowKwh ?? 20);
  const high = Number(settings?.settings.energyUsageHighKwh ?? 30);

  const stats = useMemo(() => {
    const rows = (data?.data.days ?? []).filter((row) => Number.isFinite(row.kwh) && row.kwh >= 0).slice(-7);
    if (rows.length === 0) return null;

    const latest = rows[rows.length - 1];
    const average = rows.reduce((sum, row) => sum + row.kwh, 0) / rows.length;
    const max = Math.max(...rows.map((row) => row.kwh), high, 1);
    const axisMax = Math.max(10, Math.ceil(max / 10) * 10);

    return { rows, latest, average, axisMax };
  }, [data, high]);

  if (loading) return <WidgetState label="Henter elforbrug…" />;
  if (error || !stats) return <WidgetState label="Elforbruget kunne ikke hentes" />;

  const width = 700;
  const height = 150;
  const left = 48;
  const right = 8;
  const top = 8;
  const bottom = 28;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const slot = plotWidth / stats.rows.length;
  const barWidth = Math.min(48, slot * 0.58);
  const baseline = height - bottom;
  const y = (value: number) => top + (1 - Math.min(stats.axisMax, Math.max(0, value)) / stats.axisMax) * plotHeight;
  const ticks = [0, stats.axisMax / 2, stats.axisMax];

  return (
    <div className="home-week-bars-block home-usage-chart-block">
      <div className="home-week-summary">
        <strong>{stats.latest.kwh.toFixed(1).replace(".", ",")} kWh</strong>
        <span>seneste registrerede døgn</span>
        <small>7-dages gns. {stats.average.toFixed(1).replace(".", ",")} kWh</small>
      </div>
      <div className="home-usage-band-legend" aria-label="Forbrugsgrænser">
        <span className="low">Lav ≤ {low.toFixed(1).replace(".", ",")}</span>
        <span className="medium">Middel</span>
        <span className="high">Høj ≥ {high.toFixed(1).replace(".", ",")} kWh</span>
      </div>
      <svg className="home-usage-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Elforbrug de seneste 7 dage i kilowatt-timer">
        {ticks.map((tick) => {
          const yy = y(tick);
          return <g key={tick}>
            <line x1={left} y1={yy} x2={width - right} y2={yy} className="home-mini-grid" />
            <text x={left - 7} y={yy + 4} textAnchor="end" className="home-mini-axis">{Math.round(tick)}</text>
          </g>;
        })}
        <text x="3" y={top + 5} className="home-mini-axis home-usage-axis-unit">kWh</text>
        {stats.rows.map((row, index) => {
          const xx = left + index * slot + (slot - barWidth) / 2;
          const yy = y(row.kwh);
          const barHeight = Math.max(2, baseline - yy);
          const band = usageBand(row.kwh, low, high);
          return <g key={row.date} className={`home-usage-bar home-usage-bar--${band}`}>
            <rect x={xx} y={baseline - barHeight} width={barWidth} height={barHeight} rx="5">
              <title>{shortDay(row.date)} · {row.kwh.toFixed(1).replace(".", ",")} kWh</title>
            </rect>
            <text x={xx + barWidth / 2} y={height - 8} textAnchor="middle" className="home-mini-axis home-usage-day-label">{shortDay(row.date)}</text>
          </g>;
        })}
        <line x1={left} y1={baseline} x2={width - right} y2={baseline} className="home-usage-baseline" />
      </svg>
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
