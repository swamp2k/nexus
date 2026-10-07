import { getAuthenticatedUser } from '../auth/session';
import { createOpaqueToken, hashToken } from '../auth/tokens';
import type { PrivateeringIngestPayload, PrivateeringOverview, PrivateeringTorrent, PrivateeringFile } from './contract';

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function authorizeIngest(env: Env, request: Request): Promise<boolean> {
  const header = request.headers.get('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token || token.length > 500) return false;
  const tokenHash = await hashToken(token);
  const row = await env.DB.prepare(
    `SELECT token_hash AS tokenHash FROM privateering_ingest_tokens WHERE token_hash = ?`,
  ).bind(tokenHash).first<{ tokenHash: string }>();
  if (!row) return false;
  // Constant-time compare even though the lookup already matched exactly,
  // to avoid any timing signal on the comparison itself.
  const encoder = new TextEncoder();
  const received = encoder.encode(tokenHash);
  const target = encoder.encode(row.tokenHash);
  if (received.length !== target.length) return false;
  let difference = 0;
  for (let index = 0; index < target.length; index++) difference |= received[index] ^ target[index];
  return difference === 0;
}

function cleanTorrents(value: unknown): PrivateeringTorrent[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object').map((item) => ({
    hash: String(item.hash ?? ''),
    name: String(item.name ?? ''),
    sizeBytes: typeof item.sizeBytes === 'number' ? item.sizeBytes : 0,
    completed: item.completed === true,
    progressPct: typeof item.progressPct === 'number' ? item.progressPct : 0,
    addedAt: typeof item.addedAt === 'string' ? item.addedAt : null,
  })).filter((t) => t.hash);
}

function cleanFiles(value: unknown): PrivateeringFile[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object').map((item) => ({
    path: String(item.path ?? ''),
    sizeBytes: typeof item.sizeBytes === 'number' ? item.sizeBytes : 0,
    status: String(item.status ?? ''),
    committedAt: typeof item.committedAt === 'string' ? item.committedAt : null,
  })).filter((f) => f.path);
}

type TokenInfo = { exists: boolean; createdAt: string | null };

async function getTokenInfo(env: Env, userId: string): Promise<TokenInfo> {
  const row = await env.DB.prepare(
    `SELECT created_at AS createdAt FROM privateering_ingest_tokens WHERE user_id = ?`,
  ).bind(userId).first<{ createdAt: string }>();
  return row ? { exists: true, createdAt: row.createdAt } : { exists: false, createdAt: null };
}

export async function handlePrivateeringRoute(request: Request, env: Env): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;

  if (pathname === '/api/privateering/ingest') {
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    if (!await authorizeIngest(env, request)) return json({ error: 'unauthorized' }, 401);
    let body: Partial<PrivateeringIngestPayload>;
    try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }
    const torrents = cleanTorrents(body.torrents);
    const copyarrFiles = cleanFiles(body.copyarrFiles);
    const fetchedAt = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO privateering_snapshot (id, fetched_at, torrents_json, copyarr_files_json)
       VALUES (1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET fetched_at = excluded.fetched_at, torrents_json = excluded.torrents_json, copyarr_files_json = excluded.copyarr_files_json`,
    ).bind(fetchedAt, JSON.stringify(torrents), JSON.stringify(copyarrFiles)).run();
    return json({ ok: true, fetchedAt });
  }

  if (pathname === '/api/privateering/overview') {
    if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
    const user = await getAuthenticatedUser(request, env.DB);
    if (!user) return json({ error: 'unauthorized' }, 401);
    const row = await env.DB.prepare(
      `SELECT fetched_at AS fetchedAt, torrents_json AS torrentsJson, copyarr_files_json AS copyarrFilesJson
       FROM privateering_snapshot WHERE id = 1`,
    ).first<{ fetchedAt: string; torrentsJson: string; copyarrFilesJson: string }>();
    const overview: PrivateeringOverview = row
      ? { fetchedAt: row.fetchedAt, torrents: JSON.parse(row.torrentsJson), copyarrFiles: JSON.parse(row.copyarrFilesJson) }
      : { fetchedAt: null, torrents: [], copyarrFiles: [] };
    return json(overview);
  }

  if (pathname === '/api/privateering/ingest-token') {
    const user = await getAuthenticatedUser(request, env.DB);
    if (!user) return json({ error: 'unauthorized' }, 401);

    if (request.method === 'GET') {
      return json(await getTokenInfo(env, user.id));
    }

    if (request.method === 'POST') {
      if (user.role === 'viewer') return json({ error: 'forbidden' }, 403);
      const token = createOpaqueToken();
      const tokenHash = await hashToken(token);
      const createdAt = new Date().toISOString();
      await env.DB.prepare(
        `INSERT INTO privateering_ingest_tokens (user_id, token_hash, created_at)
         VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET token_hash = excluded.token_hash, created_at = excluded.created_at`,
      ).bind(user.id, tokenHash, createdAt).run();
      return json({ token, createdAt });
    }

    if (request.method === 'DELETE') {
      if (user.role === 'viewer') return json({ error: 'forbidden' }, 403);
      await env.DB.prepare(`DELETE FROM privateering_ingest_tokens WHERE user_id = ?`).bind(user.id).run();
      return json({ ok: true });
    }

    return json({ error: 'method_not_allowed' }, 405);
  }

  return null;
}
