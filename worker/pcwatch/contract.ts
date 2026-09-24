/** Consumer copy of PC Watch's versioned read contract. */
export const CONTRACT_VERSION = 1;
export type PcWatchDevice = {
  id: string; name: string; owner: string | null; lastSeenAt: string | null;
  metricsAt: string | null; cpuPct: number | null; ramPct: number | null; tempC: number | null;
  gpuPct: number | null; diskFreeGb: number | null; uptimeSeconds: number | null;
  openAlerts: number; agentOutdated: boolean;
};
export type PcWatchAlert = { id: number; deviceId: string; deviceName: string; type: string; triggeredAt: string; message: string | null };
export type PcWatchBackupAgent = { id: string; name: string; status: string; version: string | null; lastSeenAt: string | null; remotes: string[] };
export type PcWatchBackupTask = {
  id: string; name: string; agentId: string; agentName: string; remote: string | null; enabled: boolean;
  nextDueAt: string | null; scheduleIntervalHours: number | null; lastRunStatus: string | null;
  lastRunAt: string | null; lastRunProgressPct: number | null; lastRunBytesProcessed: number | null;
  lastRunError: string | null; lastSuccessAt: string | null;
};
export type PcWatchDeviceBackup = { deviceId: string; deviceName: string; destinationName: string | null; lastStatus: string | null; lastAt: string | null; lastSizeBytes: number | null; nextDueAt: string | null };
export type PcWatchOverview = { contractVersion: number; fetchedAt: string; devices: PcWatchDevice[]; alerts: PcWatchAlert[]; backupAgents: PcWatchBackupAgent[]; backupTasks: PcWatchBackupTask[]; deviceBackups: PcWatchDeviceBackup[] };
export interface PcWatchIntegration {
  identify(token: string): Promise<{ contractVersion: number; scope: 'read' }>;
  getOverview(token: string): Promise<PcWatchOverview>;
}
