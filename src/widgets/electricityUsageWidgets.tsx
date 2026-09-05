import { useMemo } from "react";
import ChartFrame from "../dashboard/ChartFrame";
import { useDashboardJson } from "../data/dashboardRefresh";
import { useSettings } from "../data/settings";
import { bandFor, bandsFrom, DEFAULT_USAGE_BANDS } from "../data/api-types";
import type { ElectricityUsageResponse } from "../data/api-types";
import type { WidgetDefinition } from "./widgetRegistry";

function WidgetState({ label }: { label: string }) {
  return <div className="home-widget-state">{label}</div>;
}

function shortDay(value: string): string {
  return new Intl.DateTimeFormat("da-DK", { weekday: "short" }).format(new Date(`${value}T12:00:00`));
}

function kwh(value: number): string {
  return value.toFixed(1).replace(".", ",");
}

function ElectricityUsageWeekWidget() {
  const { data, loading, error } = useDashboardJson<ElectricityUsageResponse>("/api/sources/energy/usage");
  const { data: settings } = useSettings();
  const bands = bandsFrom(settings?.settings.energyUsageLowKwh, settings?.settings.energyUsageHighKwh, DEFAULT_USAGE_BANDS);

  const stats = useMemo(() => {
    const rows = (data?.data.days ?? []).filter((row) => Number.isFinite(row.kwh) && row.kwh >= 0).slice(-7);
    if (rows.length === 0) return null;
    const latest = rows[rows.length - 1];
    const average = rows.reduce((sum, row) => sum + row.kwh, 0) / rows.length;
    const max = Math.max(...rows.map((row) => row.kwh), bands.high, 1);
    const axisMax = Math.max(10, Math.ceil(max / 10) * 10);
    return { rows, latest, average, axisMax };
  }, [data, bands.high]);

  if (loading) return <WidgetState label="Henter elforbrug…" />;
  if (error || !stats) return <WidgetState label="Elforbruget kunne ikke hentes" />;

  return (
    <div className="widget-fill">
      <div className="chart-summary"><strong>{kwh(stats.latest.kwh)} kWh</strong><span>seneste registrerede døgn</span><small>7-dages gns. {kwh(stats.average)} kWh</small></div>
      <div className="band-legend" aria-label="Forbrugsgrænser"><span className="low">Lav ≤ {kwh(bands.low)}</span><span className="medium">Middel</span><span className="high">Høj ≥ {kwh(bands.high)} kWh</span></div>
      <ChartFrame label="Elforbrug de seneste 7 dage i kilowatt-timer">{({ width, height }) => {
        const left = 34, right = 6, top = 16, bottom = 18;
        const plotWidth = width - left - right;
        const plotHeight = height - top - bottom;
        const slot = plotWidth / stats.rows.length;
        const barWidth = Math.max(6, Math.min(44, slot * 0.58));
        const baseline = height - bottom;
        const y = (value: number) => top + (1 - Math.min(stats.axisMax, Math.max(0, value)) / stats.axisMax) * plotHeight;
        const ticks = [0, stats.axisMax / 2, stats.axisMax];
        const showValues = slot >= 30;
        return <>
          {ticks.map((tick) => <g key={tick}><line x1={left} y1={y(tick)} x2={width - right} y2={y(tick)} className="chart-grid" /><text x={left - 6} y={y(tick) + 3.5} textAnchor="end" className="chart-axis">{Math.round(tick)}</text></g>)}
          {stats.rows.map((row, index) => {
            const x = left + index * slot + (slot - barWidth) / 2;
            const barHeight = Math.max(2, baseline - y(row.kwh));
            const band = bandFor(row.kwh, bands);
            return <g key={row.date} className={`chart-bar chart-bar--${band}`}>
              <rect x={x} y={baseline - barHeight} width={barWidth} height={barHeight} rx="4"><title>{shortDay(row.date)} · {kwh(row.kwh)} kWh</title></rect>
              {showValues && <text x={x + barWidth / 2} y={Math.max(top - 4, baseline - barHeight - 4)} textAnchor="middle" className="chart-axis chart-axis--strong">{kwh(row.kwh)}</text>}
              <text x={x + barWidth / 2} y={height - 5} textAnchor="middle" className="chart-axis">{shortDay(row.date)}</text>
            </g>;
          })}
          <line x1={left} y1={baseline} x2={width - right} y2={baseline} className="chart-baseline" />
        </>;
      }}</ChartFrame>
      {data?.stale && <p className="chart-note">Viser seneste kendte Eloverblik-data</p>}
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
    surfaces: ["home", "display"],
    defaultSize: "medium",
    supportedSizes: ["small", "medium", "wide"],
    rows: 2,
    component: ElectricityUsageWeekWidget,
  },
];
