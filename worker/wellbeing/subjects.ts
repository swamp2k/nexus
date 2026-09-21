import { getAuthenticatedUser } from "../auth/session";

type SubjectRow = {
  id: string;
  name: string;
  kind: "self" | "person";
  isDefault: number;
  allowMultipleCheckins: number;
  garminEnabled: number;
  active: number;
};

function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));
}

async function subjectForUser(db: D1Database, userId: string, subjectId: string): Promise<SubjectRow | null> {
  return db.prepare(
    `SELECT id, name, kind, is_default AS isDefault,
            allow_multiple_checkins AS allowMultipleCheckins,
            garmin_enabled AS garminEnabled, active
     FROM wellbeing_subjects
     WHERE id = ? AND user_id = ? AND active = 1 LIMIT 1`,
  ).bind(subjectId, userId).first<SubjectRow>();
}

async function listSubjects(request: Request, env: Env): Promise<Response> {
  const user = await getAuthenticatedUser(request, env.DB);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });
  const rows = await env.DB.prepare(
    `SELECT id, name, kind, is_default AS isDefault,
            allow_multiple_checkins AS allowMultipleCheckins,
            garmin_enabled AS garminEnabled, active
     FROM wellbeing_subjects
     WHERE user_id = ? AND active = 1
     ORDER BY is_default DESC, created_at`,
  ).bind(user.id).all<SubjectRow>();
  return json({ subjects: rows.results });
}

async function createSubject(request: Request, env: Env): Promise<Response> {
  const user = await getAuthenticatedUser(request, env.DB);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });
  if (user.role === "viewer") return json({ error: "forbidden" }, { status: 403 });

  let body: { name?: unknown; allowMultipleCheckins?: unknown } = {};
  try { body = await request.json(); } catch { return json({ error: "invalid_json" }, { status: 400 }); }
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
  if (!name) return json({ error: "name_required" }, { status: 400 });

  const subjectId = crypto.randomUUID();
  const now = new Date().toISOString();
  const multiple = body.allowMultipleCheckins === false ? 0 : 1;
  await env.DB.prepare(
    `INSERT INTO wellbeing_subjects
       (id, user_id, name, kind, is_default, allow_multiple_checkins, garmin_enabled, active, created_at, updated_at)
     VALUES (?, ?, ?, 'person', 0, ?, 0, 1, ?, ?)`,
  ).bind(subjectId, user.id, name, multiple, now, now).run();

  const starter = [
    ["Mentalt overskud", "🧠", "high_good"],
    ["Humør", "🙂", "high_good"],
    ["Uro / stress", "🌪️", "high_bad"],
    ["Kravtolerance", "🧩", "high_good"],
    ["Social kapacitet", "👥", "high_good"],
  ] as const;
  await env.DB.batch(starter.map(([metricName, emoji, direction], index) => env.DB.prepare(
    `INSERT INTO wellbeing_metrics
       (id, user_id, name, emoji, direction, value_type, sort_order, active, created_at, updated_at, subject_id)
     VALUES (?, ?, ?, ?, ?, 'scale', ?, 1, ?, ?, ?)`,
  ).bind(crypto.randomUUID(), user.id, metricName, emoji, direction, index, now, now, subjectId)));

  return json({ subject: { id: subjectId, name, kind: "person", isDefault: 0, allowMultipleCheckins: multiple, garminEnabled: 0, active: 1 } }, { status: 201 });
}

async function subjectDay(request: Request, env: Env): Promise<Response> {
  const user = await getAuthenticatedUser(request, env.DB);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const subjectId = url.searchParams.get("subjectId") ?? "";
  const date = url.searchParams.get("date") ?? "";
  if (!subjectId || !validDate(date)) return json({ error: "invalid_request" }, { status: 400 });
  const subject = await subjectForUser(env.DB, user.id, subjectId);
  if (!subject) return json({ error: "subject_not_found" }, { status: 404 });

  const [metrics, checkins] = await Promise.all([
    env.DB.prepare(
      `SELECT id, name, emoji, direction, value_type AS valueType, sort_order AS sortOrder
       FROM wellbeing_metrics
       WHERE user_id = ? AND subject_id = ? AND active = 1
       ORDER BY sort_order, created_at`,
    ).bind(user.id, subjectId).all(),
    env.DB.prepare(
      `SELECT id, entry_date AS entryDate, occurred_at AS occurredAt, created_at AS createdAt
       FROM wellbeing_checkins
       WHERE user_id = ? AND subject_id = ? AND entry_date = ?
       ORDER BY occurred_at DESC, created_at DESC`,
    ).bind(user.id, subjectId, date).all<{ id: string; entryDate: string; occurredAt: string; createdAt: string }>(),
  ]);

  const result = [];
  for (const checkin of checkins.results) {
    const [values, journals] = await Promise.all([
      env.DB.prepare(
        `SELECT metric_id AS metricId, value
         FROM wellbeing_entries
         WHERE user_id = ? AND subject_id = ? AND checkin_id = ?`,
      ).bind(user.id, subjectId, checkin.id).all(),
      env.DB.prepare(
        `SELECT id, body, created_at AS createdAt, updated_at AS updatedAt
         FROM journal_entries
         WHERE user_id = ? AND subject_id = ? AND checkin_id = ?
         ORDER BY created_at`,
      ).bind(user.id, subjectId, checkin.id).all(),
    ]);
    result.push({ ...checkin, values: values.results, journals: journals.results });
  }

  return json({ subject, date, metrics: metrics.results, checkins: result });
}

async function createCheckin(request: Request, env: Env): Promise<Response> {
  const user = await getAuthenticatedUser(request, env.DB);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });
  if (user.role === "viewer") return json({ error: "forbidden" }, { status: 403 });

  let body: { subjectId?: unknown; occurredAt?: unknown; values?: unknown; comment?: unknown } = {};
  try { body = await request.json(); } catch { return json({ error: "invalid_json" }, { status: 400 }); }
  const subjectId = typeof body.subjectId === "string" ? body.subjectId : "";
  const occurredAt = typeof body.occurredAt === "string" ? body.occurredAt : new Date().toISOString();
  const parsed = new Date(occurredAt);
  if (!subjectId || Number.isNaN(parsed.getTime())) return json({ error: "invalid_request" }, { status: 400 });
  const subject = await subjectForUser(env.DB, user.id, subjectId);
  if (!subject) return json({ error: "subject_not_found" }, { status: 404 });

  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Copenhagen", year: "numeric", month: "2-digit", day: "2-digit" }).format(parsed);
  if (!subject.allowMultipleCheckins) {
    const existing = await env.DB.prepare(
      `SELECT id FROM wellbeing_checkins WHERE user_id = ? AND subject_id = ? AND entry_date = ? LIMIT 1`,
    ).bind(user.id, subjectId, date).first<{ id: string }>();
    if (existing) return json({ error: "checkin_already_exists" }, { status: 409 });
  }

  const values = body.values && typeof body.values === "object" && !Array.isArray(body.values)
    ? body.values as Record<string, unknown> : {};
  const allowedRows = await env.DB.prepare(
    `SELECT id, value_type AS valueType FROM wellbeing_metrics
     WHERE user_id = ? AND subject_id = ? AND active = 1`,
  ).bind(user.id, subjectId).all<{ id: string; valueType: "scale" | "boolean" }>();
  const allowed = new Map(allowedRows.results.map((row) => [row.id, row.valueType]));

  const checkinId = crypto.randomUUID();
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO wellbeing_checkins (id, user_id, subject_id, entry_date, occurred_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(checkinId, user.id, subjectId, date, parsed.toISOString(), now, now),
  ];

  for (const [metricId, raw] of Object.entries(values)) {
    const valueType = allowed.get(metricId);
    if (!valueType || raw === null || raw === undefined || raw === "") continue;
    const value = Number(raw);
    const valid = valueType === "boolean" ? (value === 0 || value === 1) : Number.isInteger(value) && value >= 1 && value <= 5;
    if (!valid) return json({ error: "invalid_metric_value" }, { status: 400 });
    statements.push(env.DB.prepare(
      `INSERT INTO wellbeing_entries
         (id, user_id, subject_id, checkin_id, metric_id, entry_date, value, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), user.id, subjectId, checkinId, metricId, date, value, now, now));
  }

  let journalId: string | null = null;
  const comment = typeof body.comment === "string" ? body.comment.trim().slice(0, 20_000) : "";
  if (comment) {
    journalId = crypto.randomUUID();
    const conversationId = crypto.randomUUID();
    statements.push(env.DB.prepare(
      `INSERT INTO journal_entries
         (id, user_id, entry_date, body, created_at, updated_at, subject_id, checkin_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(journalId, user.id, date, comment, now, now, subjectId, checkinId));
    statements.push(env.DB.prepare(
      `INSERT INTO miyagi_conversation_messages
         (id, user_id, role, body, kind, analysis_id, journal_entry_id, source_ref, created_at, subject_id, checkin_id)
       VALUES (?, ?, 'user', ?, 'checkin', NULL, ?, ?, ?, ?, ?)`,
    ).bind(conversationId, user.id, comment, journalId, `journal_entries:${journalId}`, now, subjectId, checkinId));
  }

  await env.DB.batch(statements);
  return json({ checkin: { id: checkinId, subjectId, entryDate: date, occurredAt: parsed.toISOString(), journalId } }, { status: 201 });
}

export async function handleWellbeingSubjectRoute(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === "/api/wellbeing/subjects" && request.method === "GET") return listSubjects(request, env);
  if (url.pathname === "/api/wellbeing/subjects" && request.method === "POST") return createSubject(request, env);
  if (url.pathname === "/api/wellbeing/subject-day" && request.method === "GET") return subjectDay(request, env);
  if (url.pathname === "/api/wellbeing/checkins" && request.method === "POST") return createCheckin(request, env);
  return null;
}
