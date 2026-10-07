import { readSourceCache } from '../sources/cache';
import type { ResourceKind } from './contract';

export type ProjectsEnv = Env & { GITHUB_TOKEN?: string; CF_API_TOKEN?: string; CF_ACCOUNT_ID?: string };

export const SCAN_KEY = 'projects.scan';
const SCAN_INTERVAL_MS = 24 * 60 * 60 * 1000;

type Found = { name: string; meta: Record<string, unknown> };
type Obj = Record<string, unknown>;

function asObj(value: unknown): Obj { return value && typeof value === 'object' ? value as Obj : {}; }
function str(value: unknown): string | null { return typeof value === 'string' ? value : null; }

async function getJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function scanGitHub(token: string): Promise<Found[]> {
  const found: Found[] = [];
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'nexus-projects' };
  for (let page = 1; page <= 20; page++) {
    const body = await getJson(`https://api.github.com/user/repos?affiliation=owner&per_page=100&page=${page}`, headers);
    if (!Array.isArray(body)) throw new Error('unexpected response');
    for (const item of body.map(asObj)) {
      const name = str(item.full_name);
      if (name) found.push({ name, meta: { archived: item.archived === true, private: item.private === true, pushedAt: str(item.pushed_at), sizeKb: item.size } });
    }
    if (body.length < 100) break;
  }
  return found;
}

async function cfList(token: string, path: string, perPage: number): Promise<Obj[]> {
  const items: Obj[] = [];
  const headers = { Authorization: `Bearer ${token}` };
  for (let page = 1; page <= 20; page++) {
    const sep = path.includes('?') ? '&' : '?';
    const body = asObj(await getJson(`https://api.cloudflare.com/client/v4${path}${sep}page=${page}&per_page=${perPage}`, headers));
    if (body.success !== true || !Array.isArray(body.result)) throw new Error('unexpected response');
    items.push(...body.result.map(asObj));
    const totalPages = Number(asObj(body.result_info).total_pages ?? 1);
    if (!Number.isFinite(totalPages) || page >= totalPages || body.result.length === 0) break;
  }
  return items;
}

async function scanWorkers(token: string, account: string): Promise<Found[]> {
  // The scripts list is not paginated; pass no paging params.
  const body = asObj(await getJson(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts`, { Authorization: `Bearer ${token}` }));
  if (body.success !== true || !Array.isArray(body.result)) throw new Error('unexpected response');
  return body.result.map(asObj).flatMap((item) => {
    const name = str(item.id);
    return name ? [{ name, meta: { modifiedAt: str(item.modified_on), createdAt: str(item.created_on) } }] : [];
  });
}

async function scanPages(token: string, account: string): Promise<Found[]> {
  const items = await cfList(token, `/accounts/${account}/pages/projects`, 10);
  return items.flatMap((item) => {
    const name = str(item.name);
    return name ? [{ name, meta: { domains: Array.isArray(item.domains) ? item.domains : [], modifiedAt: str(asObj(item.latest_deployment).created_on) } }] : [];
  });
}

async function scanD1(token: string, account: string): Promise<Found[]> {
  const items = await cfList(token, `/accounts/${account}/d1/database`, 100);
  return items.flatMap((item) => {
    const name = str(item.name);
    return name ? [{ name, meta: { createdAt: str(item.created_at), sizeBytes: item.file_size } }] : [];
  });
}

async function replaceKind(db: D1Database, kind: ResourceKind, found: Found[], seenAt: string): Promise<void> {
  const insert = db.prepare(`INSERT OR REPLACE INTO project_discovery (kind, name, meta_json, seen_at) VALUES (?, ?, ?, ?)`);
  await db.batch([
    db.prepare(`DELETE FROM project_discovery WHERE kind = ?`).bind(kind),
    ...found.map((item) => insert.bind(kind, item.name, JSON.stringify(item.meta), seenAt)),
  ]);
}

/** Scans every source. A failed source keeps its previous rows; errors are recorded, never thrown. */
export async function runProjectsScan(env: ProjectsEnv): Promise<{ scannedAt: string; errors: string[] }> {
  const scannedAt = new Date().toISOString();
  const errors: string[] = [];
  const account = env.CF_ACCOUNT_ID ?? '';
  const sources: Array<{ kind: ResourceKind; label: string; run: () => Promise<Found[]> }> = [
    { kind: 'repo', label: 'GitHub', run: () => env.GITHUB_TOKEN ? scanGitHub(env.GITHUB_TOKEN) : Promise.reject(new Error('GITHUB_TOKEN mangler')) },
    { kind: 'worker', label: 'Workers', run: () => env.CF_API_TOKEN && account ? scanWorkers(env.CF_API_TOKEN, account) : Promise.reject(new Error('CF_API_TOKEN/CF_ACCOUNT_ID mangler')) },
    { kind: 'pages', label: 'Pages', run: () => env.CF_API_TOKEN && account ? scanPages(env.CF_API_TOKEN, account) : Promise.reject(new Error('CF_API_TOKEN/CF_ACCOUNT_ID mangler')) },
    { kind: 'd1', label: 'D1', run: () => env.CF_API_TOKEN && account ? scanD1(env.CF_API_TOKEN, account) : Promise.reject(new Error('CF_API_TOKEN/CF_ACCOUNT_ID mangler')) },
  ];
  await Promise.all(sources.map(async (source) => {
    try {
      await replaceKind(env.DB, source.kind, await source.run(), scannedAt);
    } catch (error) {
      errors.push(`${source.label}: ${error instanceof Error ? error.message : 'ukendt fejl'}`);
    }
  }));
  const message = errors.length ? errors.sort().join(' · ') : null;
  await env.DB.prepare(
    `INSERT INTO source_cache (source_key, payload_json, fetched_at, expires_at, last_error_at, last_error_message)
     VALUES (?, '{}', ?, ?, ?, ?)
     ON CONFLICT(source_key) DO UPDATE SET fetched_at = excluded.fetched_at, expires_at = excluded.expires_at,
       last_error_at = excluded.last_error_at, last_error_message = excluded.last_error_message`,
  ).bind(SCAN_KEY, scannedAt, new Date(Date.parse(scannedAt) + SCAN_INTERVAL_MS).toISOString(), message ? scannedAt : null, message).run();
  return { scannedAt, errors };
}

/** Called from the hourly cron; only scans when the last scan is older than a day. */
export async function runProjectsScanIfDue(env: ProjectsEnv): Promise<{ scanned: boolean; errors?: string[] }> {
  const last = await readSourceCache<unknown>(env.DB, SCAN_KEY);
  if (last && !last.stale) return { scanned: false };
  const result = await runProjectsScan(env);
  return { scanned: true, errors: result.errors };
}
