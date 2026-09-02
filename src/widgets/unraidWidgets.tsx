import type { ReactNode } from "react";
import { useDashboardJson } from "../data/dashboardRefresh";
import type { WidgetDefinition } from "./widgetRegistry";

export type UnraidContainer = { id: string; name: string; status: string };
export type UnraidVM = { id: string; name: string; status: string };
export type UnraidDisk = { slot: string; name: string; temp: number | null; health: string; usedGb: number; totalGb: number };
export type UnraidArray = { status: string; capacityUsedTb: number; capacityTotalTb: number; disks: UnraidDisk[]; cache: UnraidDisk[] };
export type UnraidUPS = { model: string; status: string; batteryPct: number; runtimeMin: number; loadPct: number };
export type UnraidOverview = {
  contractVersion: number;
  fetchedAt: string;
  server: { label: string; online: boolean; monitorOfflineSince: string | null };
  stats: { cpuPct: number; ramPct: number; ramUsedGb: number; ramTotalGb: number; uptimeS: number; tempAvg: number | null };
  array: UnraidArray | null;
  containers: UnraidContainer[];
  vms: UnraidVM[];
  shares: Array<{ name: string; usedGb: number; totalGb: number; pct: number }>;
  ups: UnraidUPS | null;
  unavailable: Array<"array" | "containers" | "vms" | "shares">;
};

const FLEX = ["small", "medium", "wide"] as const;
const CONTAINER_PREFIX = "unraid.container.";
const VM_PREFIX = "unraid.vm.";

function statusOk(status: string): boolean {
  const value = status.toLowerCase();
  return value.includes("run") || value.includes("started") || value.includes("online") || value.includes("normal");
}

function uptime(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  return days > 0 ? `${days} d ${hours} t` : `${hours} t`;
}

function useOverview() {
  return useDashboardJson<UnraidOverview>("/api/unraid/overview");
}

function State({ children }: { children: ReactNode }) {
  return <div className="home-widget-state">{children}</div>;
}

function Metric({ value, label, detail }: { value: string; label: string; detail?: string }) {
  return <div className="home-metric"><strong>{value}</strong><span>{label}</span>{detail && <small>{detail}</small>}</div>;
}

function SystemWidget() {
  const { data, loading, error } = useOverview();
  if (loading) return <State>Henter serverstatus…</State>;
  if (error || !data) return <State>Systemdata kunne ikke hentes</State>;
  return <div className="unraid-home-system">
    <div className="unraid-home-server"><strong>{data.server.online ? "ONLINE" : "OFFLINE"}</strong><span>{data.server.label}</span></div>
    <div className="home-wellbeing-metrics">
      <span>CPU <strong>{data.stats.cpuPct.toFixed(1)}%</strong></span>
      <span>RAM <strong>{data.stats.ramPct.toFixed(1)}%</strong></span>
      <span>Temp <strong>{data.stats.tempAvg === null ? "—" : `${data.stats.tempAvg}°C`}</strong></span>
      <span>Uptime <strong>{uptime(data.stats.uptimeS)}</strong></span>
    </div>
  </div>;
}

function CpuWidget() {
  const { data, loading, error } = useOverview();
  if (loading) return <State>Henter CPU…</State>;
  if (error || !data) return <State>CPU kunne ikke hentes</State>;
  return <Metric value={`${data.stats.cpuPct.toFixed(1)}%`} label="CPU-belastning" detail={data.stats.tempAvg === null ? undefined : `${data.stats.tempAvg}°C gennemsnit`} />;
}

function RamWidget() {
  const { data, loading, error } = useOverview();
  if (loading) return <State>Henter RAM…</State>;
  if (error || !data) return <State>RAM kunne ikke hentes</State>;
  return <Metric value={`${data.stats.ramPct.toFixed(1)}%`} label="RAM i brug" detail={`${data.stats.ramUsedGb.toFixed(1)} / ${data.stats.ramTotalGb.toFixed(1)} GB`} />;
}

function TemperatureWidget() {
  const { data, loading, error } = useOverview();
  if (loading) return <State>Henter temperatur…</State>;
  if (error || !data) return <State>Temperatur kunne ikke hentes</State>;
  return <Metric value={data.stats.tempAvg === null ? "—" : `${data.stats.tempAvg}°C`} label="Systemtemperatur" detail="Gennemsnit fra Unraid" />;
}

function UptimeWidget() {
  const { data, loading, error } = useOverview();
  if (loading) return <State>Henter uptime…</State>;
  if (error || !data) return <State>Uptime kunne ikke hentes</State>;
  return <Metric value={uptime(data.stats.uptimeS)} label="Uptime" detail={data.server.label} />;
}

function ArrayWidget() {
  const { data, loading, error } = useOverview();
  if (loading) return <State>Henter array…</State>;
  if (error || !data) return <State>Array kunne ikke hentes</State>;
  if (!data.array) return <State>Array-status utilgængelig</State>;
  const pct = data.array.capacityTotalTb > 0 ? Math.round((data.array.capacityUsedTb / data.array.capacityTotalTb) * 100) : 0;
  return <Metric value={`${data.array.capacityUsedTb.toFixed(1)} TB`} label={`af ${data.array.capacityTotalTb.toFixed(1)} TB`} detail={`${pct}% · ${data.array.status}`} />;
}

function DiskTemperatureWidget() {
  const { data, loading, error } = useOverview();
  if (loading) return <State>Henter disktemperaturer…</State>;
  if (error || !data?.array) return <State>Disktemperaturer utilgængelige</State>;
  const disks = [...data.array.disks, ...data.array.cache];
  return <div className="home-wellbeing-metrics">{disks.map((disk) => <span key={`${disk.slot}:${disk.name}`}>{disk.name} <strong>{disk.temp === null ? "—" : `${disk.temp}°C`}</strong></span>)}</div>;
}

function DockerSummaryWidget() {
  const { data, loading, error } = useOverview();
  if (loading) return <State>Henter Docker…</State>;
  if (error || !data) return <State>Docker kunne ikke hentes</State>;
  if (data.unavailable.includes("containers")) return <State>Docker-status utilgængelig</State>;
  const running = data.containers.filter((item) => statusOk(item.status)).length;
  return <Metric value={`${running}/${data.containers.length}`} label="containere kører" />;
}

function VmSummaryWidget() {
  const { data, loading, error } = useOverview();
  if (loading) return <State>Henter VM'er…</State>;
  if (error || !data) return <State>VM-status kunne ikke hentes</State>;
  if (data.unavailable.includes("vms")) return <State>VM-status utilgængelig</State>;
  const running = data.vms.filter((item) => statusOk(item.status)).length;
  return <Metric value={`${running}/${data.vms.length}`} label="VM'er kører" />;
}

function UpsWidget() {
  const { data, loading, error } = useOverview();
  if (loading) return <State>Henter UPS…</State>;
  if (error || !data) return <State>UPS kunne ikke hentes</State>;
  if (!data.ups) return <State>Ingen UPS fundet</State>;
  return <Metric value={`${data.ups.batteryPct}%`} label={data.ups.model} detail={`${Math.round(data.ups.runtimeMin)} min · load ${data.ups.loadPct}%`} />;
}

function entityWidget(kind: "container" | "vm", id: string) {
  return function EntityWidget() {
    const { data, loading, error } = useOverview();
    if (loading) return <State>Henter status…</State>;
    if (error || !data) return <State>Status kunne ikke hentes</State>;
    const unavailable = kind === "container" ? data.unavailable.includes("containers") : data.unavailable.includes("vms");
    if (unavailable) return <State>Status utilgængelig</State>;
    const item = kind === "container" ? data.containers.find((candidate) => candidate.id === id) : data.vms.find((candidate) => candidate.id === id);
    if (!item) return <State>{kind === "container" ? "Container" : "VM"} ikke fundet</State>;
    return <div className={`unraid-entity-status ${statusOk(item.status) ? "ok" : "warn"}`}><span className="unraid-entity-dot" aria-hidden="true" /><strong>{statusOk(item.status) ? "Kører" : item.status}</strong><small>{kind === "container" ? "Docker" : "VM"}</small></div>;
  };
}

function parseDynamicEntity(widgetId: string, prefix: string): { id: string; name: string } | null {
  if (!widgetId.startsWith(prefix)) return null;
  const payload = widgetId.slice(prefix.length);
  const separator = payload.indexOf(":");
  if (separator <= 0) return null;
  try {
    return {
      id: decodeURIComponent(payload.slice(0, separator)),
      name: decodeURIComponent(payload.slice(separator + 1)),
    };
  } catch {
    return null;
  }
}

export function isUnraidContainerWidgetId(widgetId: string): boolean {
  return widgetId.startsWith(CONTAINER_PREFIX);
}

export function SelectedContainersWidget({ widgetIds }: { widgetIds: string[] }) {
  const { data, loading, error } = useOverview();
  if (loading) return <State>Henter containerstatus…</State>;
  if (error || !data) return <State>Containerstatus kunne ikke hentes</State>;
  if (data.unavailable.includes("containers")) return <State>Docker-status utilgængelig</State>;

  const selected = widgetIds
    .map((widgetId) => parseDynamicEntity(widgetId, CONTAINER_PREFIX))
    .filter((item): item is { id: string; name: string } => item !== null);

  if (selected.length === 0) return <State>Ingen containere valgt</State>;

  return <div className="unraid-container-group">
    {selected.map((selectedContainer) => {
      const container = data.containers.find((candidate) => candidate.id === selectedContainer.id);
      const ok = container ? statusOk(container.status) : false;
      const status = container ? (ok ? "Kører" : container.status) : "Ikke fundet";
      return <div className={`unraid-container-group-item ${ok ? "ok" : "warn"}`} key={selectedContainer.id} title={`${selectedContainer.name}: ${status}`}>
        <span className="unraid-entity-dot" aria-hidden="true" />
        <strong>{selectedContainer.name}</strong>
        <small>{status}</small>
      </div>;
    })}
  </div>;
}

export const unraidWidgetDefinitions: WidgetDefinition[] = [
  { id: "unraid.system.overview", title: "Server & system", description: "Online-status, CPU, RAM, temperatur og uptime", group: "Unraid", page: "Unraid", defaultSize: "medium", supportedSizes: [...FLEX], component: SystemWidget },
  { id: "unraid.system.cpu", title: "CPU", description: "Aktuel CPU-belastning", group: "Unraid", page: "Unraid", defaultSize: "small", supportedSizes: ["small", "medium"], component: CpuWidget },
  { id: "unraid.system.ram", title: "RAM", description: "RAM-forbrug", group: "Unraid", page: "Unraid", defaultSize: "small", supportedSizes: ["small", "medium"], component: RamWidget },
  { id: "unraid.system.temperature", title: "Temperatur", description: "Gennemsnitlig systemtemperatur", group: "Unraid", page: "Unraid", defaultSize: "small", supportedSizes: ["small", "medium"], component: TemperatureWidget },
  { id: "unraid.system.uptime", title: "Uptime", description: "Tid siden sidste boot", group: "Unraid", page: "Unraid", defaultSize: "small", supportedSizes: ["small", "medium"], component: UptimeWidget },
  { id: "unraid.array.usage", title: "Array", description: "Array-status og lagerforbrug", group: "Unraid", page: "Unraid", defaultSize: "small", supportedSizes: [...FLEX], component: ArrayWidget },
  { id: "unraid.disks.temperature", title: "Disktemperaturer", description: "Temperatur på array- og cache-diske", group: "Unraid", page: "Unraid", defaultSize: "medium", supportedSizes: ["medium", "wide"], component: DiskTemperatureWidget },
  { id: "unraid.docker.summary", title: "Docker", description: "Hvor mange containere der kører", group: "Unraid", page: "Unraid", defaultSize: "small", supportedSizes: ["small", "medium"], component: DockerSummaryWidget },
  { id: "unraid.vms.summary", title: "VM'er", description: "Hvor mange virtuelle maskiner der kører", group: "Unraid", page: "Unraid", defaultSize: "small", supportedSizes: ["small", "medium"], component: VmSummaryWidget },
  { id: "unraid.ups.status", title: "UPS", description: "Batteri, runtime og load", group: "Unraid", page: "Unraid", defaultSize: "small", supportedSizes: ["small", "medium"], component: UpsWidget },
];

function dynamicDefinition(kind: "container" | "vm", id: string, name: string): WidgetDefinition {
  const prefix = kind === "container" ? CONTAINER_PREFIX : VM_PREFIX;
  return {
    id: `${prefix}${encodeURIComponent(id)}:${encodeURIComponent(name)}`,
    title: name,
    description: kind === "container" ? "Vises i den samlede container-widget" : "Status for denne virtuelle maskine",
    group: kind === "container" ? "Unraid · Containere" : "Unraid · VM'er",
    page: "Unraid",
    defaultSize: kind === "container" ? "medium" : "small",
    supportedSizes: kind === "container" ? ["medium", "wide"] : ["small", "medium"],
    component: entityWidget(kind, id),
  };
}

export function dynamicUnraidWidgetDefinitions(data: UnraidOverview | null): WidgetDefinition[] {
  if (!data) return [];
  return [
    ...data.containers.map((item) => dynamicDefinition("container", item.id, item.name)),
    ...data.vms.map((item) => dynamicDefinition("vm", item.id, item.name)),
  ];
}

export function resolveDynamicUnraidWidget(widgetId: string): WidgetDefinition | undefined {
  const kind = widgetId.startsWith(CONTAINER_PREFIX) ? "container" : widgetId.startsWith(VM_PREFIX) ? "vm" : null;
  if (!kind) return undefined;
  const prefix = kind === "container" ? CONTAINER_PREFIX : VM_PREFIX;
  const parsed = parseDynamicEntity(widgetId, prefix);
  if (!parsed) return undefined;
  return dynamicDefinition(kind, parsed.id, parsed.name || (kind === "container" ? "Container" : "VM"));
}
