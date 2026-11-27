import type { RepoMeta, RepoRelease } from "./client";

export type { RepoMeta, RepoRelease };

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
  description?: string;
  category?: string;
  productionUrl?: string;
  isPublic?: boolean;
  showRepoPublic?: boolean;
  hidden?: boolean;
  pinned?: boolean;
};

export type MapSnapshot = {
  generatedAt: string;
  source: string;
  summary: { githubRepos: number; workers: number; pages: number };
  projects: MapProject[];
  repoOnly: string[];
  archivedRepoOnly: string[];
  workerPublicUrls?: Record<string, string[]>;
  repoMeta?: Record<string, RepoMeta>;
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
  description: string;
  category: string;
  productionUrl: string;
  isPublic: boolean;
  showRepoPublic: boolean;
  hidden: boolean;
  pinned: boolean;
};

export type PublicApp = {
  id: string;
  title: string;
  description: string;
  category: string;
  productionUrl: string | null;
  repoUrl: string | null;
  latestRelease: {
    tag: string;
    name: string;
    url: string;
    publishedAt: string | null;
    assets: Array<{ name: string; downloadUrl: string; size: number }>;
  } | null;
  pinned: boolean;
};

const KINDS: ResourceKind[] = ["repos", "workers", "pages", "domains"];

function list(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 100) throw new Error("invalid_resource_list");
  const cleaned = value.map((item) => {
    if (typeof item !== "string" || !item.trim() || item.length > 250) throw new Error("invalid_resource");
    return item.trim();
  });
  if (new Set(cleaned).size !== cleaned.length) throw new Error("duplicate_resource");
  return cleaned;
}

export function normalizeOptionalHttpsUrl(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new Error("invalid_production_url");
  const raw = value.trim();
  if (!raw) return "";
  if (raw.length > 300) throw new Error("invalid_production_url");
  const candidate = raw.includes("://") ? raw : `https://${raw}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("invalid_production_url");
  }
  if (parsed.protocol !== "https:" || !parsed.hostname.includes(".") || parsed.username || parsed.password) {
    throw new Error("invalid_production_url");
  }
  if (parsed.pathname === "/" && !parsed.search && !parsed.hash) return parsed.origin;
  return parsed.toString();
}

function tryHttpsUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const normalized = normalizeOptionalHttpsUrl(value);
    return normalized || null;
  } catch {
    return null;
  }
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
  const description = typeof record.description === "string" ? record.description.trim() : "";
  if (description.length > 400) throw new Error("invalid_description");
  const category = typeof record.category === "string" ? record.category.trim() : "";
  if (category.length > 40) throw new Error("invalid_category");

  return {
    id: record.id,
    title: record.title.trim(),
    repos: list(record.repos),
    workers: list(record.workers),
    pages: list(record.pages),
    domains: list(record.domains),
    confirmed: record.confirmed === true,
    description,
    category,
    productionUrl: normalizeOptionalHttpsUrl(record.productionUrl),
    isPublic: record.isPublic === true,
    showRepoPublic: record.showRepoPublic !== false,
    hidden: record.hidden === true,
    pinned: record.pinned === true,
  };
}

export async function readRegistry(db: D1Database): Promise<RegistryEntry[]> {
  const rows = await db.prepare(
    `SELECT id, title, repos_json, workers_json, pages_json, domains_json, confirmed,
            description, category, production_url, is_public, show_repo_public, hidden, pinned
     FROM project_map_registry`
  ).all<{
    id: string;
    title: string;
    repos_json: string;
    workers_json: string;
    pages_json: string;
    domains_json: string;
    confirmed: number;
    description: string;
    category: string;
    production_url: string;
    is_public: number;
    show_repo_public: number;
    hidden: number;
    pinned: number;
  }>();
  return (rows.results ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    repos: JSON.parse(row.repos_json) as string[],
    workers: JSON.parse(row.workers_json) as string[],
    pages: JSON.parse(row.pages_json) as string[],
    domains: JSON.parse(row.domains_json) as string[],
    confirmed: row.confirmed === 1,
    description: row.description ?? "",
    category: row.category ?? "",
    productionUrl: row.production_url ?? "",
    isPublic: row.is_public === 1,
    showRepoPublic: row.show_repo_public !== 0,
    hidden: row.hidden === 1,
    pinned: row.pinned === 1,
  }));
}

export async function saveRegistry(db: D1Database, entry: RegistryEntry): Promise<void> {
  await db.prepare(
    `INSERT INTO project_map_registry (
       id, title, repos_json, workers_json, pages_json, domains_json, confirmed,
       description, category, production_url, is_public, show_repo_public, hidden, pinned, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(id) DO UPDATE SET
       title=excluded.title,
       repos_json=excluded.repos_json,
       workers_json=excluded.workers_json,
       pages_json=excluded.pages_json,
       domains_json=excluded.domains_json,
       confirmed=excluded.confirmed,
       description=excluded.description,
       category=excluded.category,
       production_url=excluded.production_url,
       is_public=excluded.is_public,
       show_repo_public=excluded.show_repo_public,
       hidden=excluded.hidden,
       pinned=excluded.pinned,
       updated_at=CURRENT_TIMESTAMP`
  ).bind(
    entry.id,
    entry.title,
    JSON.stringify(entry.repos),
    JSON.stringify(entry.workers),
    JSON.stringify(entry.pages),
    JSON.stringify(entry.domains),
    entry.confirmed ? 1 : 0,
    entry.description,
    entry.category,
    entry.productionUrl,
    entry.isPublic ? 1 : 0,
    entry.showRepoPublic ? 1 : 0,
    entry.hidden ? 1 : 0,
    entry.pinned ? 1 : 0,
  ).run();
}

export async function deleteRegistry(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM project_map_registry WHERE id = ?").bind(id).run();
}

export function resourceConflict(entry: RegistryEntry, others: RegistryEntry[]): string | null {
  for (const other of others) {
    if (other.id === entry.id) continue;
    for (const kind of KINDS) {
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
  for (const entry of entries) for (const kind of KINDS) claimed[kind].push(...entry[kind]);
  const claimSets = Object.fromEntries(KINDS.map((kind) => [kind, new Set(claimed[kind])])) as Record<ResourceKind, Set<string>>;
  const projects: MapProject[] = [];

  for (const original of snapshot.projects) {
    const manual = byId.get(original.id);
    if (manual) {
      projects.push({
        ...original,
        title: manual.title,
        repo: manual.repos[0] ?? null,
        repos: manual.repos,
        workers: manual.workers,
        pages: manual.pages,
        domains: manual.domains,
        confirmed: manual.confirmed,
        manual: true,
        status: manual.confirmed ? "confirmed" : "manual",
        description: manual.description,
        category: manual.category,
        productionUrl: manual.productionUrl,
        isPublic: manual.isPublic,
        showRepoPublic: manual.showRepoPublic,
        hidden: manual.hidden,
        pinned: manual.pinned,
        warnings: KINDS.flatMap((kind) => manual[kind].filter((name) => !inventory[kind].includes(name)).map((name) => `Missing from latest scan: ${name}`)),
      });
      continue;
    }

    const repos = (original.repos ?? (original.repo ? [original.repo] : [])).filter((name) => !claimSets.repos.has(name));
    const workers = (original.workers ?? []).filter((name) => !claimSets.workers.has(name));
    const pages = (original.pages ?? []).filter((name) => !claimSets.pages.has(name));
    const domains = (original.domains ?? []).filter((name) => !claimSets.domains.has(name));
    if (!repos.length && !workers.length && !pages.length && !domains.length) continue;
    const altered = repos.length !== (original.repos ?? (original.repo ? [original.repo] : [])).length ||
      workers.length !== (original.workers ?? []).length || pages.length !== (original.pages ?? []).length ||
      domains.length !== (original.domains ?? []).length;
    projects.push({
      ...original,
      repo: repos[0] ?? null,
      repos,
      workers,
      pages,
      domains,
      description: "",
      category: "",
      productionUrl: "",
      isPublic: false,
      showRepoPublic: true,
      hidden: false,
      pinned: false,
      warnings: altered ? ["Remaining unconfirmed resources; other links were assigned manually"] : original.warnings,
    });
  }

  for (const entry of entries) {
    if (snapshot.projects.some((project) => project.id === entry.id)) continue;
    projects.push({
      ...entry,
      repo: entry.repos[0] ?? null,
      manual: true,
      status: entry.confirmed ? "confirmed" : "manual",
      warnings: KINDS.flatMap((kind) => entry[kind].filter((name) => !inventory[kind].includes(name)).map((name) => `Missing from latest scan: ${name}`)),
    });
  }

  return {
    ...snapshot,
    projects: projects.sort((a, b) => a.title.localeCompare(b.title)),
    repoOnly: snapshot.repoOnly.filter((name) => !claimSets.repos.has(name)),
    archivedRepoOnly: snapshot.archivedRepoOnly.filter((name) => !claimSets.repos.has(name)),
    inventory,
    repoMeta: snapshot.repoMeta ?? {},
  };
}

function findRepoMeta(repoMeta: Record<string, RepoMeta> | undefined, fullName: string): RepoMeta | undefined {
  if (!repoMeta) return undefined;
  if (repoMeta[fullName]) return repoMeta[fullName];
  const lower = fullName.toLowerCase();
  for (const [key, value] of Object.entries(repoMeta)) {
    if (key.toLowerCase() === lower) return value;
  }
  return undefined;
}

export function buildPublicApps(snapshot: MapSnapshot | null, entries: RegistryEntry[]): PublicApp[] {
  const apps: PublicApp[] = [];

  for (const entry of entries) {
    if (!entry.isPublic || entry.hidden) continue;

    // Only expose metadata from repositories explicitly known to be public.
    const publicRepos = entry.repos
      .map((name) => findRepoMeta(snapshot?.repoMeta, name))
      .filter((meta): meta is RepoMeta => Boolean(meta && meta.isPrivate === false));

    const firstPublicRepo = publicRepos[0];
    const releaseRepo = publicRepos.find((meta) => Boolean(meta.latestRelease));

    const productionUrl =
      tryHttpsUrl(entry.productionUrl) ??
      entry.domains.map(tryHttpsUrl).find((u): u is string => Boolean(u)) ??
      entry.workers.flatMap((w) => snapshot?.workerPublicUrls?.[w] ?? []).map(tryHttpsUrl).find((u): u is string => Boolean(u)) ??
      tryHttpsUrl(firstPublicRepo?.homepage) ??
      null;

    const description = entry.description.trim() || firstPublicRepo?.description?.trim() || "";
    const repoUrl = entry.showRepoPublic && firstPublicRepo ? firstPublicRepo.url : null;

    apps.push({
      id: entry.id,
      title: entry.title,
      description,
      category: entry.category.trim(),
      productionUrl,
      repoUrl,
      latestRelease: releaseRepo?.latestRelease ?? null,
      pinned: entry.pinned,
    });
  }

  return apps.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return a.title.localeCompare(b.title);
  });
}
