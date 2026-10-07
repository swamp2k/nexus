/** Data pushed in by a local agent on behalf of rTorrent + Copyarr. Copyarr/rTorrent run
 * locally and are not reachable from the Worker, so they must push instead of Nexus pulling. */
export type PrivateeringTorrent = {
  hash: string;
  name: string;
  sizeBytes: number;
  completed: boolean;
  progressPct: number;
  addedAt: string | null;
};

export type PrivateeringFile = {
  path: string;
  sizeBytes: number;
  status: string;
  committedAt: string | null;
};

export type PrivateeringIngestPayload = {
  torrents: PrivateeringTorrent[];
  copyarrFiles: PrivateeringFile[];
};

export type PrivateeringOverview = {
  fetchedAt: string | null;
  torrents: PrivateeringTorrent[];
  copyarrFiles: PrivateeringFile[];
};
