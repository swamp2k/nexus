export type ProjectStatus = 'active' | 'done' | 'retired';
export type ResourceKind = 'repo' | 'worker' | 'pages' | 'd1';

export type Project = {
  id: string;
  name: string;
  description: string;
  url: string | null;
  status: ProjectStatus;
  repos: string[];
  workers: string[];
  pages: string[];
  d1: string[];
  notes: string | null;
  updatedAt: string;
};

export type DiscoveredResource = {
  kind: ResourceKind;
  name: string;
  meta: Record<string, unknown>;
  seenAt: string;
};

export type MissingResource = { projectId: string; kind: ResourceKind; name: string };

export type ProjectsOverview = {
  projects: Project[];
  drift: {
    untracked: DiscoveredResource[];
    missing: MissingResource[];
    noCode: string[];
  };
  counts: Record<ResourceKind, number>;
  lastScanAt: string | null;
  lastScanError: string | null;
};
