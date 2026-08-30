import { getAuthenticatedUser } from "../auth/session";

type MetricRow = {
  id: string;
  name: string;
  emoji: string;
  direction: "high_good" | "high_bad";
  sortOrder: number;
  active: number;
  createdAt: string;
  updatedAt: string;
};

type EntryRow = {
  metricId: string;
  value: number;
};

type JournalRow = {
  id: string;
  entryDate: string;
  body: string;
  createdAt: string;
  updatedAt: string;
};

function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

function validDate(value: string | null): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));
}

function cleanEmoji(value: unknown): string {
  if (typeof value !== "string") return "🙂";
  const trimmed = value.trim();
  return trimmed ? [...trimmed].slice(0, 4).join("") : "🙂";
}

async function requireUser(request: Request, env: Env) {
  return getAuthenticatedUser(request, env.DB);
}

async function listMetrics(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });

  const result = await env.DB.prepare(
    `SELECT id, name, emoji, direction, sort_order AS sortOrder, active,
            created_at AS createdAt, updated_at AS updatedAt
     FROM wellbeing_metrics
     WHERE user_id = ?
     ORDER BY active DESC, sort_order, created_at`,
  ).bind(user.id).all<MetricRow>();

  return json({ metrics: result.results });
}

async function createMetric(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });
  if (user.role === "viewer") return json({ error: "forbidden" }, { status: 403 });

  let body: { name?: unknown; emoji?: unknown; direction?: unknown } = {};
  try { body = await request.json(); } catch { return json({ error: "invalid_json" }, { status: 400 }); }

  const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
  const direction = body.direction === "high_bad" ? "high_bad" : "high_good";
  if (!name) return json({ error: "name_required" }, { status: 400 });

  const max = await env.DB.prepare(
    `SELECT COALESCE(MAX(sort_order), -1) AS maxOrder FROM wellbeing_metrics WHERE user_id = ?`,
  ).bind(user.id).first<{ maxOrder: number }>();

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const emoji = cleanEmoji(body.emoji);
  const sortOrder = Number(max?.maxOrder ?? -1) + 1;

  await env.DB.prepare(
    `INSERT INTO wellbeing_metrics
       (id, user_id, name, emoji, direction, sort_order, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  ).bind(id, user.id, name, emoji, direction, sortOrder, now, now).run();

  return json({ metric: { id, name, emoji, direction, sortOrder, active: 1, createdAt: now, updatedAt: now } }, { status: 201 });
}

async function updateMetric(request: Request, env: Env, metricId: string): Promise<Response> {
  const user = await requireUser(request, env);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });
  if (user.role === "viewer") return json({ error: "forbidden" }, { status: 403 });

  const existing = await env.DB.prepare(
    `SELECT id, name, emoji, direction, sort_order AS sortOrder, active
     FROM wellbeing_metrics WHERE id = ? AND user_id = ? LIMIT 1`,
  ).bind(metricId, user.id).first<MetricRow>();
  if (!existing) return json({ error: "metric_not_found" }, { status: 404 });

  let body: { name?: unknown; emoji?: unknown; direction?: unknown; active?: unknown; sortOrder?: unknown } = {};
  try { body = await request.json(); } catch { return json({ error: "invalid_json" }, { status: 400 }); }

  const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : existing.name;
  if (!name) return json({ error: "name_required" }, { status: 400 });
  const emoji = body.emoji === undefined ? existing.emoji : cleanEmoji(body.emoji);
  const direction = body.direction === "high_bad" ? "high_bad" : body.direction === "high_good" ? "high_good" : existing.direction;
  const active = typeof body.active === "boolean" ? (body.active ? 1 : 0) : Number(existing.active ?? 1);
  const sortOrder = Number.isInteger(body.sortOrder) ? Number(body.sortOrder) : Number(existing.sortOrder ?? 0);
  const now = new Date().toISOString();

  await env.DB.prepare(
    `UPDATE wellbeing_metrics
     SET name = ?, emoji = ?, direction = ?, active = ?, sort_order = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`,
  ).bind(name, emoji, direction, active, sortOrder, now, metricId, user.id).run();

  return json({ metric: { id: metricId, name, emoji, direction, active, sortOrder, updatedAt: now } });
}

async function dayState(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });
  const date = new URL(request.url).searchParams.get("date");
  if (!validDate(date)) return json({ error: "invalid_date" }, { status: 400 });

  const [metrics, entries, journals] = await Promise.all([
    env.DB.prepare(
      `SELECT id, name, emoji, direction, sort_order AS sortOrder, active,
              created_at AS createdAt, updated_at AS updatedAt
       FROM wellbeing_metrics WHERE user_id = ? AND active = 1 ORDER BY sort_order, created_at`,
    ).bind(user.id).all<MetricRow>(),
    env.DB.prepare(
      `SELECT metric_id AS metricId, value FROM wellbeing_entries
       WHERE user_id = ? AND entry_date = ?`,
    ).bind(user.id, date).all<EntryRow>(),
    env.DB.prepare(
      `SELECT id, entry_date AS entryDate, body, created_at AS createdAt, updated_at AS updatedAt
       FROM journal_entries WHERE user_id = ? AND entry_date = ? ORDER BY created_at DESC`,
    ).bind(user.id, date).all<JournalRow>(),
  ]);

  return json({ date, metrics: metrics.results, entries: entries.results, journals: journals.results });
}

async function saveDay(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });
  if (user.role === "viewer") return json({ error: "forbidden" }, { status: 403 });

  let body: { date?: unknown; values?: unknown } = {};
  try { body = await request.json(); } catch { return json({ error: "invalid_json" }, { status: 400 }); }
  const date = typeof body.date === "string" ? body.date : null;
  if (!validDate(date)) return json({ error: "invalid_date" }, { status: 400 });
  if (!body.values || typeof body.values !== "object" || Array.isArray(body.values)) return json({ error: "invalid_values" }, { status: 400 });

  const values = body.values as Record<string, unknown>;
  const metricIds = Object.keys(values);
  if (metricIds.length > 50) return json({ error: "too_many_values" }, { status: 400 });

  const owned = await env.DB.prepare(`SELECT id FROM wellbeing_metrics WHERE user_id = ? AND active = 1`)
    .bind(user.id).all<{ id: string }>();
  const allowed = new Set(owned.results.map((row) => row.id));
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];

  for (const metricId of metricIds) {
    if (!allowed.has(metricId)) return json({ error: "metric_not_found" }, { status: 404 });
    const value = Number(values[metricId]);
    if (!Number.isInteger(value) || value < 1 || value > 5) return json({ error: "invalid_metric_value" }, { status: 400 });
    statements.push(env.DB.prepare(
      `INSERT INTO wellbeing_entries (id, user_id, metric_id, entry_date, value, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, metric_id, entry_date)
       DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).bind(crypto.randomUUID(), user.id, metricId, date, value, now, now));
  }

  if (statements.length) await env.DB.batch(statements);
  return json({ ok: true, date, saved: statements.length, updatedAt: now });
}

async function listRecent(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });
  const requested = Number(new URL(request.url).searchParams.get("days") ?? 30);
  const days = Math.max(1, Math.min(180, Number.isFinite(requested) ? Math.floor(requested) : 30));

  const result = await env.DB.prepare(
    `SELECT e.entry_date AS entryDate, e.metric_id AS metricId, e.value,
            m.name, m.emoji, m.direction
     FROM wellbeing_entries e
     JOIN wellbeing_metrics m ON m.id = e.metric_id
     WHERE e.user_id = ?
     ORDER BY e.entry_date DESC, m.sort_order
     LIMIT ?`,
  ).bind(user.id, days * 50).all();

  return json({ days, entries: result.results });
}

async function createJournal(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });
  if (user.role === "viewer") return json({ error: "forbidden" }, { status: 403 });

  let body: { date?: unknown; body?: unknown } = {};
  try { body = await request.json(); } catch { return json({ error: "invalid_json" }, { status: 400 }); }
  const date = typeof body.date === "string" ? body.date : null;
  const text = typeof body.body === "string" ? body.body.trim().slice(0, 20_000) : "";
  if (!validDate(date)) return json({ error: "invalid_date" }, { status: 400 });
  if (!text) return json({ error: "journal_body_required" }, { status: 400 });

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO journal_entries (id, user_id, entry_date, body, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(id, user.id, date, text, now, now).run();
  return json({ journal: { id, entryDate: date, body: text, createdAt: now, updatedAt: now } }, { status: 201 });
}

async function deleteJournal(request: Request, env: Env, journalId: string): Promise<Response> {
  const user = await requireUser(request, env);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });
  if (user.role === "viewer") return json({ error: "forbidden" }, { status: 403 });
  const result = await env.DB.prepare(`DELETE FROM journal_entries WHERE id = ? AND user_id = ?`)
    .bind(journalId, user.id).run();
  if (!result.meta.changes) return json({ error: "journal_not_found" }, { status: 404 });
  return json({ ok: true });
}

export async function handleWellbeingRoute(request: Request, env: Env): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;

  if (pathname === "/api/wellbeing/metrics" && request.method === "GET") return listMetrics(request, env);
  if (pathname === "/api/wellbeing/metrics" && request.method === "POST") return createMetric(request, env);
  if (pathname === "/api/wellbeing/day" && request.method === "GET") return dayState(request, env);
  if (pathname === "/api/wellbeing/day" && request.method === "PUT") return saveDay(request, env);
  if (pathname === "/api/wellbeing/recent" && request.method === "GET") return listRecent(request, env);
  if (pathname === "/api/wellbeing/journal" && request.method === "POST") return createJournal(request, env);

  const metricMatch = pathname.match(/^\/api\/wellbeing\/metrics\/([0-9a-f-]+)$/i);
  if (metricMatch && request.method === "PUT") return updateMetric(request, env, metricMatch[1]);

  const journalMatch = pathname.match(/^\/api\/wellbeing\/journal\/([0-9a-f-]+)$/i);
  if (journalMatch && request.method === "DELETE") return deleteJournal(request, env, journalMatch[1]);

  return null;
}
