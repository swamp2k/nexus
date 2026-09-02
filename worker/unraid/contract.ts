/**
 * The UnraidWatch integration contract, v1 — as consumed by Nexus.
 *
 * UnraidWatch is the source of truth for this contract. Its authoritative copy
 * lives at `worker/src/integration/contract.ts` in the unraidwatch repository;
 * this file is Nexus's declaration of the subset it depends on. Keep the two in
 * sync when the contract version changes.
 *
 * These are deliberately plain types with no Cloudflare in them. Nexus depends
 * on this contract, NOT on the Service Binding that currently carries it — see
 * `transport.ts` for the one file that knows about the transport.
 *
 * Nexus holds no Unraid GraphQL knowledge and no Unraid API key. Everything
 * here arrives already normalized by UnraidWatch.
 */

export const CONTRACT_VERSION = 1;

/** Stable failure codes, carried as the thrown Error's `message`. */
export type IntegrationErrorCode =
  | 'unauthorized'
  | 'not_configured'
  | 'upstream_unavailable'
  | 'internal';

export type UnraidStats = {
  cpuPct: number;
  ramPct: number;
  ramUsedGb: number;
  ramTotalGb: number;
  uptimeS: number;
  tempAvg: number | null;
};

export type UnraidDisk = {
  slot: string;
  name: string;
  temp: number | null;
  health: string;
  usedGb: number;
  totalGb: number;
};

export type UnraidArray = {
  status: string;
  capacityUsedTb: number;
  capacityTotalTb: number;
  disks: UnraidDisk[];
  cache: UnraidDisk[];
};

export type UnraidContainer = { id: string; name: string; status: string };
export type UnraidVM = { id: string; name: string; status: string };
export type UnraidShare = { name: string; usedGb: number; totalGb: number; pct: number };
export type UnraidUPS = {
  model: string;
  status: string;
  batteryPct: number;
  runtimeMin: number;
  loadPct: number;
};

export type UnraidServer = {
  label: string;
  /** Reachable at `fetchedAt` — proven by the read itself in a successful overview. */
  online: boolean;
  /**
   * UnraidWatch's availability monitor's view, or null when it considers the
   * server up. Separate from `online` and can lag it: the monitor runs once a
   * minute, so a reachable server may still be flagged during recovery.
   */
  monitorOfflineSince: string | null;
};

/**
 * Sections that can independently report failure. UPS is absent by design —
 * see the note on `UnraidOverview.ups`.
 */
export type OverviewSection = "array" | "containers" | "vms" | "shares";

export type UnraidOverview = {
  contractVersion: number;
  fetchedAt: string;
  server: UnraidServer;
  stats: UnraidStats;
  /** Null only when `unavailable` includes "array". */
  array: UnraidArray | null;
  containers: UnraidContainer[];
  vms: UnraidVM[];
  shares: UnraidShare[];
  /** Null for "no UPS configured" — in v1 also null if the UPS query failed. */
  ups: UnraidUPS | null;
  /** Sections that could not be read this cycle. Empty on a clean read. */
  unavailable: OverviewSection[];
};

export type IntegrationIdentity = {
  contractVersion: number;
  /** Null when the UnraidWatch account has no Unraid server saved yet. */
  serverLabel: string | null;
  serverConfigured: boolean;
  scope: 'read';
};

/**
 * The methods Nexus calls. The token is a plain argument, so this signature is
 * equally meaningful over RPC (argument) and HTTP (Authorization header).
 */
export interface UnraidWatchIntegration {
  identify(token: string): Promise<IntegrationIdentity>;
  getOverview(token: string): Promise<UnraidOverview>;
  getStats(token: string): Promise<UnraidStats>;
  getArray(token: string): Promise<UnraidArray>;
  getDocker(token: string): Promise<UnraidContainer[]>;
  getVMs(token: string): Promise<UnraidVM[]>;
  getShares(token: string): Promise<UnraidShare[]>;
  getUPS(token: string): Promise<UnraidUPS | null>;
}
