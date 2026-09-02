import { getAuthenticatedUser } from "../auth/session";
import { decryptUnraidValue, encryptUnraidValue } from "./credentials";
import { getArray, getContainers, getShares, getStats, getUPS, getVMs } from "./client";

type UnraidEnv = Env & { UNRAID_CREDENTIALS_KEY?: string; GARMIN_CREDENTIALS_KEY?: string };

type ServerRow = {
  label: string;
  url: string;
  apiKeyCiphertext: string;
  apiKeyIv: string;
  verifiedAt: string | null;
  updatedAt: string;
};

function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

function normalizeUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password || !url.hostname) return null;
    return url.toString().replace(/\/$/, "");
  } catch { return null; }
}

async function readServer(env: UnraidEnv, userId: string): Promise<ServerRow | null> {
  return env.DB.prepare(
    `SELECT label, url, api_key_ciphertext AS apiKeyCiphertext, api_key_iv AS apiKeyIv,
            verified_at AS verifiedAt, updated_at AS updatedAt
     FROM unraid_servers WHERE user_id = ?`,
  ).bind(userId).first<ServerRow>();
}

async function connection(env: UnraidEnv, userId: string) {
  const row = await readServer(env, userId);
  if (!row) throw new Error("unraid_not_configured");
  const apiKey = await decryptUnraidValue(env, row.apiKeyCiphertext, row.apiKeyIv);
  return { row, apiKey };
}

export async function unraidOverviewForUser(env: UnraidEnv, userId: string) {
  const { row, apiKey } = await connection(env, userId);
  const [stats, array, containers, vms, shares, ups] = await Promise.all([
    getStats(row.url, apiKey), getArray(row.url, apiKey), getContainers(row.url, apiKey), getVMs(row.url, apiKey), getShares(row.url, apiKey), getUPS(row.url, apiKey),
  ]);
  return { provider: "Unraid GraphQL", fetchedAt: new Date().toISOString(), server: { label: row.label }, stats, array, containers, vms, shares, ups };
}

function errorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : "unraid_fetch_failed";
  const status = message === "unraid_not_configured" ? 409
    : message === "unraid_invalid_api_key" ? 401
    : message === "unraid_credentials_key_not_configured" || message === "unraid_credentials_key_invalid" ? 503
    : 502;
  return json({ error: message }, { status });
}

export async function handleUnraidRoute(request: Request, env: UnraidEnv): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  if (!pathname.startsWith("/api/unraid/")) return null;

  const user = await getAuthenticatedUser(request, env.DB);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });

  if (pathname === "/api/unraid/server" && request.method === "GET") {
    try {
      const row = await readServer(env, user.id);
      return json(row ? { configured: true, server: { label: row.label, url: row.url, verifiedAt: row.verifiedAt, updatedAt: row.updatedAt } } : { configured: false, server: null });
    } catch { return json({ error: "unraid_config_unavailable" }, { status: 503 }); }
  }

  if (pathname === "/api/unraid/server" && request.method === "PUT") {
    if (user.role === "viewer") return json({ error: "forbidden" }, { status: 403 });
    let body: { label?: unknown; url?: unknown; apiKey?: unknown };
    try { body = await request.json(); } catch { return json({ error: "invalid_json" }, { status: 400 }); }
    const label = typeof body.label === "string" && body.label.trim() ? body.label.trim().slice(0, 80) : "Tower";
    const url = normalizeUrl(body.url);
    const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    if (!url || !apiKey || apiKey.length > 1000) return json({ error: "invalid_unraid_server" }, { status: 400 });
    try {
      await getStats(url, apiKey);
      const encrypted = await encryptUnraidValue(env, apiKey);
      const now = new Date().toISOString();
      await env.DB.prepare(
        `INSERT INTO unraid_servers (user_id,label,url,api_key_ciphertext,api_key_iv,verified_at,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?)
         ON CONFLICT(user_id) DO UPDATE SET label=excluded.label,url=excluded.url,
           api_key_ciphertext=excluded.api_key_ciphertext,api_key_iv=excluded.api_key_iv,
           verified_at=excluded.verified_at,updated_at=excluded.updated_at`,
      ).bind(user.id, label, url, encrypted.ciphertext, encrypted.iv, now, now, now).run();
      return json({ configured: true, server: { label, url, verifiedAt: now, updatedAt: now } });
    } catch (error) { return errorResponse(error); }
  }

  if (pathname === "/api/unraid/server" && request.method === "DELETE") {
    if (user.role === "viewer") return json({ error: "forbidden" }, { status: 403 });
    await env.DB.prepare("DELETE FROM unraid_servers WHERE user_id = ?").bind(user.id).run();
    return json({ ok: true });
  }

  if (pathname === "/api/unraid/test" && request.method === "POST") {
    try {
      const { row, apiKey } = await connection(env, user.id);
      await getStats(row.url, apiKey);
      const now = new Date().toISOString();
      await env.DB.prepare("UPDATE unraid_servers SET verified_at = ?, updated_at = ? WHERE user_id = ?").bind(now, now, user.id).run();
      return json({ ok: true, verifiedAt: now });
    } catch (error) { return errorResponse(error); }
  }

  if (request.method === "GET") {
    try {
      if (pathname === "/api/unraid/overview") return json(await unraidOverviewForUser(env, user.id));
      const { row, apiKey } = await connection(env, user.id);
      if (pathname === "/api/unraid/stats") return json({ data: await getStats(row.url, apiKey), fetchedAt: new Date().toISOString() });
      if (pathname === "/api/unraid/array") return json({ data: await getArray(row.url, apiKey), fetchedAt: new Date().toISOString() });
      if (pathname === "/api/unraid/docker") return json({ data: await getContainers(row.url, apiKey), fetchedAt: new Date().toISOString() });
      if (pathname === "/api/unraid/vms") return json({ data: await getVMs(row.url, apiKey), fetchedAt: new Date().toISOString() });
      if (pathname === "/api/unraid/shares") return json({ data: await getShares(row.url, apiKey), fetchedAt: new Date().toISOString() });
      if (pathname === "/api/unraid/ups") return json({ data: await getUPS(row.url, apiKey), fetchedAt: new Date().toISOString() });
    } catch (error) { return errorResponse(error); }
  }

  return null;
}
