import { getAuthenticatedUser } from "../auth/session";

type ReminderEnv = Env & { CHECKIN_DISCORD_WEBHOOK_URL?: string; PUBLIC_APP_URL?: string };

function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

export async function handleWellbeingReminderRoute(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/wellbeing/reminder") return null;
  const user = await getAuthenticatedUser(request, env.DB);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });

  if (request.method === "GET") {
    const rows = await env.DB.prepare(
      `SELECT r.subject_id AS subjectId, r.enabled, r.hour_local AS hourLocal, r.timezone, r.channel,
              s.name AS subjectName
       FROM wellbeing_reminders r
       JOIN wellbeing_subjects s ON s.id = r.subject_id AND s.user_id = r.user_id
       WHERE r.user_id = ? ORDER BY s.is_default DESC, s.created_at`,
    ).bind(user.id).all();
    return json({ reminders: rows.results, discordConfigured: Boolean((env as ReminderEnv).CHECKIN_DISCORD_WEBHOOK_URL?.trim()) });
  }

  if (request.method === "PUT") {
    if (user.role === "viewer") return json({ error: "forbidden" }, { status: 403 });
    let body: { subjectId?: unknown; enabled?: unknown; hourLocal?: unknown } = {};
    try { body = await request.json(); } catch { return json({ error: "invalid_json" }, { status: 400 }); }
    const subjectId = typeof body.subjectId === "string" ? body.subjectId : "";
    const hourLocal = Number(body.hourLocal);
    if (!subjectId || !Number.isInteger(hourLocal) || hourLocal < 0 || hourLocal > 23) return json({ error: "invalid_request" }, { status: 400 });
    const subject = await env.DB.prepare(`SELECT id FROM wellbeing_subjects WHERE id = ? AND user_id = ? AND active = 1`)
      .bind(subjectId, user.id).first();
    if (!subject) return json({ error: "subject_not_found" }, { status: 404 });
    const enabled = body.enabled === false ? 0 : 1;
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO wellbeing_reminders
         (id, user_id, subject_id, enabled, hour_local, timezone, channel, last_sent_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'Europe/Copenhagen', 'discord', NULL, ?, ?)
       ON CONFLICT(user_id, subject_id, channel)
       DO UPDATE SET enabled = excluded.enabled, hour_local = excluded.hour_local, updated_at = excluded.updated_at`,
    ).bind(crypto.randomUUID(), user.id, subjectId, enabled, hourLocal, now, now).run();
    return json({ ok: true, subjectId, enabled, hourLocal });
  }

  return null;
}

function localParts(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Copenhagen", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) };
}

export async function sendScheduledCheckinReminders(env: Env, now = new Date()): Promise<{ checked: number; sent: number }> {
  const webhook = (env as ReminderEnv).CHECKIN_DISCORD_WEBHOOK_URL?.trim();
  if (!webhook) return { checked: 0, sent: 0 };
  const { date, hour } = localParts(now);
  const rows = await env.DB.prepare(
    `SELECT r.id, r.user_id AS userId, r.subject_id AS subjectId, r.hour_local AS hourLocal,
            r.last_sent_date AS lastSentDate, s.name AS subjectName
     FROM wellbeing_reminders r
     JOIN wellbeing_subjects s ON s.id = r.subject_id AND s.user_id = r.user_id
     WHERE r.enabled = 1 AND r.channel = 'discord' AND r.hour_local = ?`,
  ).bind(hour).all<{ id: string; userId: string; subjectId: string; hourLocal: number; lastSentDate: string | null; subjectName: string }>();

  let sent = 0;
  for (const row of rows.results) {
    if (row.lastSentDate === date) continue;
    const done = await env.DB.prepare(
      `SELECT 1 FROM wellbeing_checkins WHERE user_id = ? AND subject_id = ? AND entry_date = ? LIMIT 1`,
    ).bind(row.userId, row.subjectId, date).first();
    if (done) continue;
    const base = (env as ReminderEnv).PUBLIC_APP_URL?.trim() || "https://nexus.starrewards.app";
    const link = `${base}/?page=wellbeing&subject=${encodeURIComponent(row.subjectId)}&checkin=1`;
    const response = await fetch(webhook, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: `Nexus check-in mangler for **${row.subjectName}**. ${link}` }),
    });
    if (!response.ok) {
      console.error(JSON.stringify({ event: "wellbeing_reminder_failed", status: response.status, subjectId: row.subjectId }));
      continue;
    }
    await env.DB.prepare(`UPDATE wellbeing_reminders SET last_sent_date = ?, updated_at = ? WHERE id = ?`)
      .bind(date, now.toISOString(), row.id).run();
    sent += 1;
  }
  return { checked: rows.results.length, sent };
}
