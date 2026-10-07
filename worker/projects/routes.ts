import { getAuthenticatedUser } from '../auth/session';
import { readSourceCache } from '../sources/cache';
import type { DiscoveredResource, MissingResource, Project, ProjectStatus, ProjectsOverview, ResourceKind } from './contract';
import { runProjectsScan, SCAN_KEY, type ProjectsEnv } from './discovery';

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

type RegistryRow = {
  id: string; name: string; description: string; url: string | null; status: ProjectStatus;
  repos_json: string; workers_json: string; pages_json: string; d1_json: string; notes: string | null; updated_at: string;
};

function parseList(value: string): string[] {
  try { const parsed: unknown = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []; }
  catch { return []; }
}

function toProject(row: RegistryRow): Project {
  return {
    id: row.id, name: row.name, description: row.description, url: row.url, status: row.status,
    repos: parseList(row.repos_json), workers: parseList(row.workers_json), pages: parseList(row.pages_json), d1: parseList(row.d1_json),
    notes: row.notes, updatedAt: row.updated_at,
  };
}

const STATUSES: ProjectStatus[] = ['active', 'done', 'retired'];

function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean))].slice(0, 50);
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, max);
  return trimmed || null;
}

function cleanProject(id: string, body: Record<string, unknown>): Project | null {
  const name = cleanText(body.name, 120);
  if (!name) return null;
  const status = STATUSES.includes(body.status as ProjectStatus) ? body.status as ProjectStatus : 'active';
  return {
    id, name, description: cleanText(body.description, 300) ?? '', url: cleanText(body.url, 300), status,
    repos: cleanList(body.repos), workers: cleanList(body.workers), pages: cleanList(body.pages), d1: cleanList(body.d1),
    notes: cleanText(body.notes, 1000), updatedAt: new Date().toISOString(),
  };
}

async function saveProject(db: D1Database, project: Project): Promise<void> {
  await db.prepare(
    `INSERT INTO project_registry (id, name, description, url, status, repos_json, workers_json, pages_json, d1_json, notes, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description, url = excluded.url,
       status = excluded.status, repos_json = excluded.repos_json, workers_json = excluded.workers_json,
       pages_json = excluded.pages_json, d1_json = excluded.d1_json, notes = excluded.notes, updated_at = excluded.updated_at`,
  ).bind(project.id, project.name, project.description, project.url, project.status,
    JSON.stringify(project.repos), JSON.stringify(project.workers), JSON.stringify(project.pages), JSON.stringify(project.d1),
    project.notes, project.updatedAt).run();
}

function slugify(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

const FIELD_BY_KIND: Record<ResourceKind, 'repos' | 'workers' | 'pages' | 'd1'> = { repo: 'repos', worker: 'workers', pages: 'pages', d1: 'd1' };

async function buildOverview(db: D1Database): Promise<ProjectsOverview> {
  const [registry, discovery, scan] = await Promise.all([
    db.prepare(`SELECT * FROM project_registry ORDER BY name COLLATE NOCASE`).all<RegistryRow>(),
    db.prepare(`SELECT kind, name, meta_json, seen_at FROM project_discovery ORDER BY kind, name`).all<{ kind: ResourceKind; name: string; meta_json: string; seen_at: string }>(),
    readSourceCache<unknown>(db, SCAN_KEY),
  ]);
  const projects = registry.results.map(toProject);
  const found: DiscoveredResource[] = discovery.results.map((row) => {
    let meta: Record<string, unknown> = {};
    try { meta = JSON.parse(row.meta_json) as Record<string, unknown>; } catch { /* keep empty */ }
    return { kind: row.kind, name: row.name, meta, seenAt: row.seen_at };
  });

  const key = (kind: ResourceKind, name: string) => `${kind}:${name.toLowerCase()}`;
  const claimed = new Set<string>();
  for (const project of projects) for (const kind of Object.keys(FIELD_BY_KIND) as ResourceKind[]) {
    for (const name of project[FIELD_BY_KIND[kind]]) claimed.add(key(kind, name));
  }
  const existing = new Set(found.map((item) => key(item.kind, item.name)));
  const scannedKinds = new Set(found.map((item) => item.kind));
  const counts: Record<ResourceKind, number> = { repo: 0, worker: 0, pages: 0, d1: 0 };
  for (const item of found) counts[item.kind]++;

  // Archived repos count as accounted for: archiving is how Martin retires them.
  const untracked = found.filter((item) => !claimed.has(key(item.kind, item.name)) && !(item.kind === 'repo' && item.meta.archived === true));
  const missing: MissingResource[] = [];
  for (const project of projects) for (const kind of Object.keys(FIELD_BY_KIND) as ResourceKind[]) {
    // Only judge kinds that have a snapshot, so an unconfigured source never flags everything as missing.
    if (!scannedKinds.has(kind)) continue;
    for (const name of project[FIELD_BY_KIND[kind]]) if (!existing.has(key(kind, name))) missing.push({ projectId: project.id, kind, name });
  }
  const noCode = projects.filter((p) => p.repos.length === 0 && p.workers.length + p.pages.length + p.d1.length > 0).map((p) => p.id);

  return {
    projects,
    drift: { untracked, missing, noCode },
    counts,
    lastScanAt: scan?.fetchedAt ?? null,
    lastScanError: scan?.lastErrorMessage ?? null,
  };
}

export async function handleProjectsRoute(request: Request, env: ProjectsEnv): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  if (pathname !== '/api/projects' && !pathname.startsWith('/api/projects/')) return null;

  const user = await getAuthenticatedUser(request, env.DB);
  if (!user) return json({ error: 'unauthorized' }, 401);
  if (user.role !== 'admin') return json({ error: 'forbidden' }, 403);

  if (pathname === '/api/projects') {
    if (request.method === 'GET') return json(await buildOverview(env.DB));
    if (request.method === 'POST') {
      let body: Record<string, unknown>;
      try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }
      const id = slugify(typeof body.id === 'string' && body.id ? body.id : String(body.name ?? ''));
      if (!id) return json({ error: 'invalid_id' }, 400);
      const exists = await env.DB.prepare(`SELECT 1 FROM project_registry WHERE id = ?`).bind(id).first();
      if (exists) return json({ error: 'exists' }, 409);
      const project = cleanProject(id, body);
      if (!project) return json({ error: 'invalid_project' }, 400);
      await saveProject(env.DB, project);
      return json(project, 201);
    }
    return json({ error: 'method_not_allowed' }, 405);
  }

  if (pathname === '/api/projects/scan') {
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    await runProjectsScan(env);
    return json(await buildOverview(env.DB));
  }

  const id = decodeURIComponent(pathname.slice('/api/projects/'.length));
  if (!id || id.includes('/')) return json({ error: 'not_found' }, 404);
  if (request.method === 'PUT') {
    let body: Record<string, unknown>;
    try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }
    const exists = await env.DB.prepare(`SELECT 1 FROM project_registry WHERE id = ?`).bind(id).first();
    if (!exists) return json({ error: 'not_found' }, 404);
    const project = cleanProject(id, body);
    if (!project) return json({ error: 'invalid_project' }, 400);
    await saveProject(env.DB, project);
    return json(project);
  }
  if (request.method === 'DELETE') {
    // Removes the registry entry only; nothing on GitHub or Cloudflare is touched.
    await env.DB.prepare(`DELETE FROM project_registry WHERE id = ?`).bind(id).run();
    return json({ ok: true });
  }
  return json({ error: 'method_not_allowed' }, 405);
}
