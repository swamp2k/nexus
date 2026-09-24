import { useDashboardJson } from '../data/dashboardRefresh';
import type { WidgetDefinition } from './widgetRegistry';

export type PcWatchOverview = {
  contractVersion: number; fetchedAt: string;
  devices: Array<{ id: string; name: string; owner: string | null; lastSeenAt: string | null; metricsAt: string | null; cpuPct: number | null; ramPct: number | null; tempC: number | null; gpuPct: number | null; diskFreeGb: number | null; uptimeSeconds: number | null; openAlerts: number; agentOutdated: boolean }>;
  alerts: Array<{ id: number; deviceId: string; deviceName: string; type: string; triggeredAt: string; message: string | null }>;
  backupAgents: Array<{ id: string; name: string; status: string; version: string | null; lastSeenAt: string | null; remotes: string[] }>;
  backupTasks: Array<{ id: string; name: string; agentId: string; agentName: string; remote: string | null; enabled: boolean; nextDueAt: string | null; scheduleIntervalHours: number | null; lastRunStatus: string | null; lastRunAt: string | null; lastRunProgressPct: number | null; lastRunBytesProcessed: number | null; lastRunError: string | null; lastSuccessAt: string | null }>;
  deviceBackups: Array<{ deviceId: string; deviceName: string; destinationName: string | null; lastStatus: string | null; lastAt: string | null; lastSizeBytes: number | null; nextDueAt: string | null }>;
};

const sizes = ['small', 'medium', 'wide'] as const;
const prefixes = { device: 'pcwatch.device.', task: 'pcwatch.backup.task.', agent: 'pcwatch.backup.agent.', backup: 'pcwatch.backup.device.' };
export const pcWatchOverviewUrl = '/api/pcwatch/overview';
export function usePcWatchOverview() {
  const query = useDashboardJson<PcWatchOverview>(pcWatchOverviewUrl);
  return query.error?.message === 'HTTP 403' ? { ...query, data: null } : query;
}
export function recent(value: string | null, minutes: number): boolean { const at = value ? Date.parse(value) : NaN; return Number.isFinite(at) && Date.now() - at >= 0 && Date.now() - at < minutes * 60_000; }
export function when(value: string | null): string { return value ? new Date(value).toLocaleString('da-DK', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Aldrig'; }
function pct(value: number | null): string { return value === null ? '—' : `${Math.round(value)}%`; }
function State({ children }: { children: string }) { return <div className="home-widget-state">{children}</div>; }
function useData() { return usePcWatchOverview(); }

function FleetWidget() {
  const { data, loading, error } = useData();
  if (loading) return <State>Henter PC-status…</State>;
  if (error && !data) return <State>PC Watch kunne ikke hentes</State>;
  if (!data) return <State>Ingen PC Watch-data</State>;
  const reporting = data.devices.filter(d => recent(d.metricsAt, 120)).length;
  return <div className="pcwatch-widget pcwatch-widget--fleet"><strong>{reporting}/{data.devices.length}</strong><span>PC'er rapporterer</span><small>{data.alerts.length} aktive alarmer · {data.devices.length - reporting} uden nylig rapport</small></div>;
}
function AlertsWidget() {
  const { data, loading, error } = useData();
  if (loading) return <State>Henter alarmer…</State>;
  if (error && !data) return <State>Alarmer kunne ikke hentes</State>;
  if (!data) return <State>Ingen PC Watch-data</State>;
  if (!data.alerts.length) return <div className="pcwatch-widget"><strong>0</strong><span>aktive alarmer</span></div>;
  return <div className="pcwatch-widget pcwatch-widget--list"><strong>{data.alerts.length} aktive alarmer</strong>{data.alerts.slice(0, 8).map(a => <div className="pcwatch-widget-row" key={a.id}><b>{a.deviceName}</b><span>{a.message ?? a.type}</span></div>)}</div>;
}
function deviceWidget(id: string) { return function DeviceWidget() {
  const { data, loading, error } = useData();
  if (loading) return <State>Henter PC…</State>;
  if (error && !data) return <State>PC-status kunne ikke hentes</State>;
  const d = data?.devices.find(item => item.id === id);
  if (!d) return <State>PC'en blev ikke fundet</State>;
  return <div className="pcwatch-widget"><strong className={recent(d.metricsAt, 120) ? 'pcwatch-good' : 'pcwatch-warn'}>{recent(d.metricsAt, 120) ? 'Rapporterer' : 'Ingen nylig rapport'}</strong><span>Sidst {when(d.metricsAt)}</span><div className="pcwatch-widget-facts"><span>CPU <b>{pct(d.cpuPct)}</b></span><span>RAM <b>{pct(d.ramPct)}</b></span><span>Temp <b>{d.tempC === null ? '—' : `${Math.round(d.tempC)}°`}</b></span><span>Disk fri <b>{d.diskFreeGb === null ? '—' : `${d.diskFreeGb.toFixed(1)} GB`}</b></span></div><small>{d.openAlerts} alarmer{d.agentOutdated ? ' · agent kan opdateres' : ''}</small></div>;
}; }
function taskWidget(id: string) { return function TaskWidget() {
  const { data, loading, error } = useData();
  if (loading) return <State>Henter backup…</State>;
  if (error && !data) return <State>Backup kunne ikke hentes</State>;
  const task = data?.backupTasks.find(item => item.id === id);
  if (!task) return <State>Backupopgaven blev ikke fundet</State>;
  const active = task.lastRunStatus === 'running' || task.lastRunStatus === 'pending';
  return <div className="pcwatch-widget"><strong className={task.lastRunStatus === 'failure' ? 'pcwatch-warn' : 'pcwatch-good'}>{!task.enabled ? 'Deaktiveret' : active ? task.lastRunStatus === 'running' ? 'Kører' : 'Afventer' : task.lastRunStatus === 'success' ? 'Gennemført' : task.lastRunStatus === 'failure' ? 'Fejlede' : 'Ingen kørsel'}</strong><span>Seneste kørsel {when(task.lastRunAt)}</span>{active && task.lastRunProgressPct !== null && <div className="pcwatch-progress"><span style={{ width: `${Math.max(0, Math.min(100, task.lastRunProgressPct))}%` }} /></div>}<div className="pcwatch-widget-facts"><span>Sidst lykkedes <b>{when(task.lastSuccessAt)}</b></span><span>Næste <b>{when(task.nextDueAt)}</b></span><span>Agent <b>{task.agentName}</b></span><span>Kilde <b>{task.remote ?? '—'}</b></span></div>{task.lastRunError && <small className="pcwatch-warn">{task.lastRunError}</small>}</div>;
}; }
function agentWidget(id: string) { return function AgentWidget() {
  const { data, loading, error } = useData();
  if (loading) return <State>Henter backup-agent…</State>;
  if (error && !data) return <State>Backup-agent kunne ikke hentes</State>;
  const agent = data?.backupAgents.find(item => item.id === id);
  if (!agent) return <State>Backup-agenten blev ikke fundet</State>;
  const online = agent.status === 'active' && recent(agent.lastSeenAt, 2);
  const running = data?.backupTasks.filter(t => t.agentId === id && t.lastRunStatus === 'running') ?? [];
  return <div className="pcwatch-widget"><strong className={online ? 'pcwatch-good' : 'pcwatch-warn'}>{online ? 'Online' : 'Ingen nylig kontakt'}</strong><span>Sidst set {when(agent.lastSeenAt)}</span><div className="pcwatch-widget-facts"><span>Version <b>{agent.version ?? '—'}</b></span><span>Aktiv backup <b>{running.map(t => t.name).join(', ') || 'Ingen'}</b></span><span>Remotes <b>{agent.remotes.join(', ') || 'Ingen'}</b></span></div></div>;
}; }
function backupWidget(id: string) { return function BackupWidget() {
  const { data, loading, error } = useData();
  if (loading) return <State>Henter PC-backup…</State>;
  if (error && !data) return <State>PC-backup kunne ikke hentes</State>;
  const backup = data?.deviceBackups.find(item => item.deviceId === id);
  if (!backup) return <State>Ingen PC-backup konfigureret</State>;
  return <div className="pcwatch-widget"><strong className={backup.lastStatus === 'failure' ? 'pcwatch-warn' : 'pcwatch-good'}>{backup.lastStatus === 'success' ? 'Gennemført' : backup.lastStatus === 'failure' ? 'Fejlede' : 'Ingen kørsel'}</strong><span>Senest {when(backup.lastAt)}</span><div className="pcwatch-widget-facts"><span>Destination <b>{backup.destinationName ?? '—'}</b></span><span>Næste <b>{when(backup.nextDueAt)}</b></span><span>Størrelse <b>{backup.lastSizeBytes === null ? '—' : `${(backup.lastSizeBytes / 1024 ** 3).toFixed(1)} GB`}</b></span></div></div>;
}; }

export const pcWatchWidgetDefinitions: WidgetDefinition[] = [
  { id: 'pcwatch.fleet', title: "PC'er", description: "Rapporterende PC'er og alarmer", group: 'PC Watch', page: 'PC Watch', defaultSize: 'small', supportedSizes: [...sizes], component: FleetWidget },
  { id: 'pcwatch.alerts', title: 'PC alarmer', description: 'Aktive alarmer fra PC Watch', group: 'PC Watch', page: 'PC Watch', defaultSize: 'medium', supportedSizes: [...sizes], rows: 2, component: AlertsWidget },
];
type Kind = keyof typeof prefixes;
function definition(kind: Kind, id: string, name: string): WidgetDefinition {
  const component = kind === 'device' ? deviceWidget(id) : kind === 'task' ? taskWidget(id) : kind === 'agent' ? agentWidget(id) : backupWidget(id);
  return { id: `${prefixes[kind]}${encodeURIComponent(id)}:${encodeURIComponent(name)}`, title: name, description: kind === 'device' ? 'PC-status' : kind === 'task' ? 'Cloud backup' : kind === 'agent' ? 'Backup-agent' : 'PC-backup', group: kind === 'device' ? 'PC Watch · PC’er' : 'PC Watch · Backup', refreshGroup: 'PC Watch', page: 'PC Watch', defaultSize: 'medium', supportedSizes: [...sizes], rows: kind === 'task' ? 2 : 1, component };
}
export function discoverPcWatchWidgets(data: PcWatchOverview | null): WidgetDefinition[] {
  if (!data) return [];
  return [
    ...data.devices.map(d => definition('device', d.id, d.name)),
    ...data.backupTasks.map(t => definition('task', t.id, t.name)),
    ...data.backupAgents.map(a => definition('agent', a.id, a.name)),
    ...data.deviceBackups.map(b => definition('backup', b.deviceId, b.deviceName)),
  ];
}
export function resolvePcWatchWidget(widgetId: string): WidgetDefinition | undefined {
  for (const kind of Object.keys(prefixes) as Kind[]) {
    const prefix = prefixes[kind];
    if (!widgetId.startsWith(prefix)) continue;
    const payload = widgetId.slice(prefix.length);
    const separator = payload.indexOf(':');
    if (separator <= 0) return undefined;
    try { return definition(kind, decodeURIComponent(payload.slice(0, separator)), decodeURIComponent(payload.slice(separator + 1))); }
    catch { return undefined; }
  }
  return undefined;
}
