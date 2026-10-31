export type MapProject = {
  id: string;
  title: string;
  repo: string | null;
  repos?: string[];
  workers: string[];
  pages: string[];
  domains: string[];
  status: string;
  warnings: string[];
  confirmed?: boolean;
  manual?: boolean;
};

export type MapSnapshot = {
  generatedAt: string;
  source: string;
  summary: { githubRepos: number; workers: number; pages: number };
  projects: MapProject[];
  repoOnly: string[];
  archivedRepoOnly: string[];
};

export type ResourceKind = "repos" | "workers" | "pages" | "domains";
export type ResourceInventory = Record<ResourceKind, string[]>;
export type RegistryEntry = {
  id: string;
  title: string;
  repos: string[];
  workers: string[];
  pages: string[];
  domains: string[];
  confirmed: boolean;
};

const KINDS: ResourceKind[] = ["repos", "workers", "pages", "domains"];
const EXCLUSIVE: ResourceKind[] = ["workers", "pages", "domains"];

function list(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 100) throw new Error("invalid_resource_list");
  const cleaned = value.map((item) => {
    if (typeof item !== "string" || !item.trim() || item.length > 250) throw new Error("invalid_resource");
    return item.trim();
  });
  if (new Set(cleaned).size !== cleaned.length) throw new Error("duplicate_resource");
  return cleaned;
}

export function inventoryOf(snapshot: MapSnapshot): ResourceInventory {
  const inventory: ResourceInventory = { repos: [], workers: [], pages: [], domains: [] };
  const collect = (kind: ResourceKind, values: string[]) => inventory[kind].push(...values);
  for (const project of snapshot.projects) {
    collect("repos", project.repos ?? (project.repo ? [project.repo] : []));
    collect("workers", project.workers ?? []);
    collect("pages", project.pages ?? []);
    collect("domains", project.domains ?? []);
  }
  collect("repos", snapshot.repoOnly ?? []);
  collect("repos", snapshot.archivedRepoOnly ?? []);
  for (const kind of KINDS) inventory[kind] = [...new Set(inventory[kind])].sort((a, b) => a.localeCompare(b));
  return inventory;
}

export function parseRegistryEntry(value: unknown): RegistryEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_body");
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(record.id)) throw new Error("invalid_id");
  if (typeof record.title !== "string" || !record.title.trim() || record.title.length > 120) throw new Error("invalid_title");
  const entry: RegistryEntry = {
    id: record.id,
    title: record.title.trim(),
    repos: list(record.repos),
    workers: list(record.workers),
    pages: list(record.pages),
    domains: list(record.domains),
    confirmed: record.confirmed === true,
  };
  return entry;
}

export async function readRegistry(db: D1Database): Promise<RegistryEntry[]> {
  const rows = await db.prepare("SELECT id, title, repos_json, workers_json, pages_json, domains_json, confirmed FROM project_map_registry").all<{
    id: string; title: string; repos_json: string; workers_json: string; pages_json: string; domains_json: string; confirmed: number;
  }>();
  return (rows.results ?? []).map((row) => ({
    id: row.id, title: row.title,
    repos: JSON.parse(row.repos_json) as string[],
    workers: JSON.parse(row.workers_json) as string[],
    pages: JSON.parse(row.pages_json) as string[],
    domains: JSON.parse(row.domains_json) as string[],
    confirmed: row.confirmed === 1,
  }));
}

export async function saveRegistry(db: D1Database, entry: RegistryEntry): Promise<void> {
  await db.prepare(
    `INSERT INTO project_map_registry (id, title, repos_json, workers_json, pages_json, domains_json, confirmed, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(id) DO UPDATE SET title=excluded.title, repos_json=excluded.repos_json,
     workers_json=excluded.workers_json, pages_json=excluded.pages_json, domains_json=excluded.domains_json,
     confirmed=excluded.confirmed, updated_at=CURRENT_TIMESTAMP`
  ).bind(entry.id, entry.title, JSON.stringify(entry.repos), JSON.stringify(entry.workers),
    JSON.stringify(entry.pages), JSON.stringify(entry.domains), entry.confirmed ? 1 : 0).run();
}

export async function deleteRegistry(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM project_map_registry WHERE id = ?").bind(id).run();
}

export function resourceConflict(entry: RegistryEntry, others: RegistryEntry[]): string | null {
  for (const other of others) {
    if (other.id === entry.id) continue;
    for (const kind of EXCLUSIVE) {
      const overlap = entry[kind].find((item) => other[kind].includes(item));
      if (overlap) return `${overlap} is already assigned to ${other.title}`;
    }
  }
  return null;
}

export function applyRegistry(snapshot: MapSnapshot, entries: RegistryEntry[]) {
  const inventory = inventoryOf(snapshot);
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const claimed: ResourceInventory = { repos: [], workers: [], pages: [], domains: [] };
  for (const entry of entries) for (const kind of EXCLUSIVE) claimed[kind].push(...entry[kind]);
  const claimSets = Object.fromEntries(KINDS.map((kind) => [kind, new Set(claimed[kind])])) as Record<ResourceKind, Set<string>>;
  const projects: MapProject[] = [];

  for (const original of snapshot.projects) {
    const manual = byId.get(original.id);
    if (manual) {
      projects.push({
        ...original, title: manual.title, repo: manual.repos[0] ?? null, repos: manual.repos,
        workers: manual.workers, pages: manual.pages, domains: manual.domains,
        confirmed: manual.confirmed, manual: true,
        status: manual.confirmed ? "confirmed" : "manual",
        warnings: KINDS.flatMap((kind) => manual[kind].filter((name) => !inventory[kind].includes(name)).map((name) => `Missing from latest scan: ${name}`)),
      });
      continue;
    }

    const repos = original.repos ?? (original.repo ? [original.repo] : []);
    const workers = (original.workers ?? []).filter((name) => !claimSets.workers.has(name));
    const pages = (original.pages ?? []).filter((name) => !claimSets.pages.has(name));
    const domains = (original.domains ?? []).filter((name) => !claimSets.domains.has(name));
    if (!repos.length && !workers.length && !pages.length && !domains.length) continue;
    const altered = repos.length !== (original.repos ?? (original.repo ? [original.repo] : [])).length ||
      workers.length !== (original.workers ?? []).length || pages.length !== (original.pages ?? []).length ||
      domains.length !== (original.domains ?? []).length;
    projects.push({
      ...original, repo: repos[0] ?? null, repos, workers, pages, domains,
      warnings: altered ? ["Remaining unconfirmed resources; other links were assigned manually"] : original.warnings,
    });
  }

  for (const entry of entries) {
    if (snapshot.projects.some((project) => project.id === entry.id)) continue;
    projects.push({
      ...entry, repo: entry.repos[0] ?? null, manual: true,
      status: entry.confirmed ? "confirmed" : "manual",
      warnings: KINDS.flatMap((kind) => entry[kind].filter((name) => !inventory[kind].includes(name)).map((name) => `Missing from latest scan: ${name}`)),
    });
  }

  return {
    ...snapshot,
    projects: projects.sort((a, b) => a.title.localeCompare(b.title)),
    repoOnly: snapshot.repoOnly.filter((name) => !entries.some((entry) => entry.repos.includes(name))),
    archivedRepoOnly: snapshot.archivedRepoOnly.filter((name) => !entries.some((entry) => entry.repos.includes(name))),
    inventory,
  };
}
