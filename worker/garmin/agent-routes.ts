import { getAuthenticatedUser } from "../auth/session";
import { processGarminDbBatch } from "./garmindb-import";
import { inventoryZip } from "./zip-inventory";

const MAX_AGENT_UPLOAD_BYTES = 100 * 1024 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type AgentPrincipal = { id: string; userId: string; name: string };

function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

function createToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `nxa_${bytesToHex(bytes)}`;
}

async function requireAgent(request: Request, env: Env): Promise<AgentPrincipal | null> {
  const auth = request.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer nxa_")) return null;
  const token = auth.slice(7).trim();
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(
    `SELECT id, user_id AS userId, name FROM garmin_agents
     WHERE token_hash = ? AND revoked_at IS NULL`,
  ).bind(tokenHash).first<AgentPrincipal>();
  if (!row) return null;
  await env.DB.prepare(`UPDATE garmin_agents SET last_seen_at = ? WHERE id = ?`).bind(new Date().toISOString(), row.id).run();
  return row;
}

async function createAgent(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, { status: 405 });
  const user = await getAuthenticatedUser(request, env.DB);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });
  let body: { name?: unknown } = {};
  try { body = await request.json(); } catch { /* optional body */ }
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 80) : "Garmin agent";
  const token = createToken();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO garmin_agents (id, user_id, name, token_hash, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).bind(id, user.id, name, await sha256(token), now).run();
  return json({ agent: { id, name, createdAt: now }, token }, { status: 201 });
}

async function rotateAgentToken(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, { status: 405 });
  const user = await getAuthenticatedUser(request, env.DB);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });
  const agent = await env.DB.prepare(
    `SELECT id, name FROM garmin_agents
     WHERE user_id = ? AND revoked_at IS NULL
     ORDER BY last_seen_at DESC, created_at DESC
     LIMIT 1`,
  ).bind(user.id).first<{ id: string; name: string }>();
  if (!agent) return json({ error: "garmin_agent_not_found" }, { status: 404 });

  const token = createToken();
  await env.DB.prepare(
    `UPDATE garmin_agents SET token_hash = ?, last_seen_at = NULL WHERE id = ? AND user_id = ?`,
  ).bind(await sha256(token), agent.id, user.id).run();

  return json({ agent: { id: agent.id, name: agent.name }, token });
}

async function listAgents(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, { status: 405 });
  const user = await getAuthenticatedUser(request, env.DB);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });
  const result = await env.DB.prepare(
    `SELECT id, name, last_seen_at AS lastSeenAt, created_at AS createdAt
     FROM garmin_agents WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC`,
  ).bind(user.id).all();
  return json({ agents: result.results });
}

async function requestSync(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, { status: 405 });
  const user = await getAuthenticatedUser(request, env.DB);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });
  const agent = await env.DB.prepare(
    `SELECT id FROM garmin_agents WHERE user_id = ? AND revoked_at IS NULL ORDER BY last_seen_at DESC, created_at DESC LIMIT 1`,
  ).bind(user.id).first<{ id: string }>();
  if (!agent) return json({ error: "garmin_agent_not_configured" }, { status: 409 });
  const existing = await env.DB.prepare(
    `SELECT id, status, requested_at AS requestedAt, updated_at AS updatedAt
     FROM garmin_sync_jobs WHERE user_id = ? AND status IN ('queued','running','processing') ORDER BY requested_at DESC LIMIT 1`,
  ).bind(user.id).first();
  if (existing) return json({ job: existing, existing: true });
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO garmin_sync_jobs (id, user_id, agent_id, status, requested_at, updated_at)
     VALUES (?, ?, ?, 'queued', ?, ?)`,
  ).bind(id, user.id, agent.id, now, now).run();
  return json({ job: { id, status: "queued", requestedAt: now, updatedAt: now }, existing: false }, { status: 201 });
}

async function syncStatus(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, { status: 405 });
  const user = await getAuthenticatedUser(request, env.DB);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });
  const job = await env.DB.prepare(
    `SELECT id, status, message, import_id AS importId, requested_at AS requestedAt,
            started_at AS startedAt, completed_at AS completedAt, updated_at AS updatedAt
     FROM garmin_sync_jobs WHERE user_id = ? ORDER BY requested_at DESC LIMIT 1`,
  ).bind(user.id).first();
  return json({ job: job ?? null });
}

async function nextJob(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, { status: 405 });
  const agent = await requireAgent(request, env);
  if (!agent) return json({ error: "unauthorized" }, { status: 401 });
  const job = await env.DB.prepare(
    `SELECT id, requested_at AS requestedAt FROM garmin_sync_jobs
     WHERE user_id = ? AND status = 'queued' ORDER BY requested_at LIMIT 1`,
  ).bind(agent.userId).first<{ id: string; requestedAt: string }>();
  if (!job) return new Response(null, { status: 204 });
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE garmin_sync_jobs SET status = 'running', agent_id = ?, started_at = COALESCE(started_at, ?), updated_at = ?
     WHERE id = ? AND status = 'queued'`,
  ).bind(agent.id, now, now, job.id).run();
  return json({ job: { ...job, status: "running" } });
}

async function failJob(request: Request, env: Env, jobId: string): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, { status: 405 });
  const agent = await requireAgent(request, env);
  if (!agent) return json({ error: "unauthorized" }, { status: 401 });
  let body: { message?: unknown } = {};
  try { body = await request.json(); } catch { /* optional */ }
  const message = typeof body.message === "string" ? body.message.slice(0, 1000) : "GarminDB sync failed";
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `UPDATE garmin_sync_jobs SET status = 'failed', message = ?, completed_at = ?, updated_at = ?
     WHERE id = ? AND user_id = ? AND status IN ('running','processing')`,
  ).bind(message, now, now, jobId, agent.userId).run();
  if (!result.meta.changes) return json({ error: "job_not_found" }, { status: 404 });
  return json({ ok: true });
}

async function uploadJob(request: Request, env: Env, jobId: string): Promise<Response> {
  if (request.method !== "PUT") return json({ error: "method_not_allowed" }, { status: 405 });
  const agent = await requireAgent(request, env);
  if (!agent) return json({ error: "unauthorized" }, { status: 401 });
  if (!request.body) return json({ error: "missing_body" }, { status: 400 });
  const length = Number(request.headers.get("Content-Length") ?? 0);
  if (!Number.isFinite(length) || length <= 0 || length > MAX_AGENT_UPLOAD_BYTES) return json({ error: "invalid_upload_size" }, { status: 413 });
  const job = await env.DB.prepare(
    `SELECT id FROM garmin_sync_jobs WHERE id = ? AND user_id = ? AND status = 'running'`,
  ).bind(jobId, agent.userId).first();
  if (!job) return json({ error: "job_not_found" }, { status: 404 });

  const importId = crypto.randomUUID();
  const key = `garmin/${agent.userId}/${importId}/source`;
  const filename = `garmindb-sync-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`;
  const object = await env.DATA.put(key, request.body, { httpMetadata: { contentType: "application/zip" } });
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO garmin_imports (id, user_id, source_filename, source_size_bytes, source_content_type,
       storage_key, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'application/zip', ?, 'uploaded', ?, ?)`,
  ).bind(importId, agent.userId, filename, object.size, key, now, now).run();

  try {
    const inventory = await inventoryZip(env.DATA, key);
    for (let offset = 0; offset < inventory.entries.length; offset += 50) {
      const chunk = inventory.entries.slice(offset, offset + 50);
      await env.DB.batch(chunk.map((entry) => env.DB.prepare(
        `INSERT INTO garmin_import_files (id, import_id, path, size_bytes, file_type, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'discovered', ?)`,
      ).bind(crypto.randomUUID(), importId, entry.path, entry.sizeBytes, entry.fileType, now)));
    }
    await env.DB.prepare(
      `UPDATE garmin_imports SET status = 'ready', file_count = ?, detected_from = ?, detected_to = ?, updated_at = ? WHERE id = ?`,
    ).bind(inventory.entries.length, inventory.detectedFrom, inventory.detectedTo, now, importId).run();
    await env.DB.prepare(
      `UPDATE garmin_sync_jobs SET status = 'processing', import_id = ?, message = NULL, updated_at = ? WHERE id = ?`,
    ).bind(importId, now, jobId).run();
    return json({ ok: true, importId, fileCount: inventory.entries.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "inventory_failed";
    await env.DB.prepare(`UPDATE garmin_imports SET status = 'failed', error_message = ?, updated_at = ? WHERE id = ?`).bind(message, now, importId).run();
    await env.DB.prepare(`UPDATE garmin_sync_jobs SET status = 'failed', message = ?, completed_at = ?, updated_at = ? WHERE id = ?`).bind(message, now, now, jobId).run();
    return json({ error: "inventory_failed", detail: message }, { status: 422 });
  }
}

async function processJob(request: Request, env: Env, jobId: string): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, { status: 405 });
  const agent = await requireAgent(request, env);
  if (!agent) return json({ error: "unauthorized" }, { status: 401 });
  const job = await env.DB.prepare(
    `SELECT import_id AS importId FROM garmin_sync_jobs WHERE id = ? AND user_id = ? AND status = 'processing'`,
  ).bind(jobId, agent.userId).first<{ importId: string | null }>();
  if (!job?.importId) return json({ error: "job_not_found" }, { status: 404 });
  const result = await processGarminDbBatch(env, agent.userId, job.importId);
  if (result.completed) {
    const now = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE garmin_sync_jobs SET status = 'complete', message = NULL, completed_at = ?, updated_at = ? WHERE id = ?`,
    ).bind(now, now, jobId).run();
  }
  return json({ ok: true, ...result });
}

export async function handleGarminAgentRoute(request: Request, env: Env): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  if (pathname === "/api/garmin/agents" && request.method === "GET") return listAgents(request, env);
  if (pathname === "/api/garmin/agents" && request.method === "POST") return createAgent(request, env);
  if (pathname === "/api/garmin/agents/token") return rotateAgentToken(request, env);
  if (pathname === "/api/garmin/sync" && request.method === "POST") return requestSync(request, env);
  if (pathname === "/api/garmin/sync" && request.method === "GET") return syncStatus(request, env);
  if (pathname === "/api/garmin/agent/jobs/next") return nextJob(request, env);

  const match = pathname.match(/^\/api\/garmin\/agent\/jobs\/([0-9a-f-]+)\/(upload|process|fail)$/i);
  if (!match || !UUID_RE.test(match[1])) return null;
  if (match[2] === "upload") return uploadJob(request, env, match[1]);
  if (match[2] === "process") return processJob(request, env, match[1]);
  return failJob(request, env, match[1]);
}
