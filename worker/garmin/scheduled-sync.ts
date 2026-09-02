import { getAuthenticatedUser } from "../auth/session";

const TIME_ZONE = "Europe/Copenhagen";
const DEFAULT_SYNC_HOURS = [9, 12, 18, 22];
const MAX_SYNCS_PER_DAY = 6;
const MIN_HOURS_BETWEEN_SYNCS = 3;

type ScheduleRow = {
  enabled: number | null;
  syncHours: string | null;
};

type ScheduledUserRow = ScheduleRow & { userId: string };

type GarminSyncSchedule = {
  enabled: boolean;
  syncHours: number[];
  timeZone: string;
};

type ScheduledSyncResult = {
  queued: number;
  skippedActive: number;
  skippedRecent: number;
  eligible: number;
  configured: number;
  localHour: number;
  reason?: string;
};

function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

export function copenhagenHour(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Number(parts.find((part) => part.type === "hour")?.value ?? -1);
}

function hasValidSpacing(hours: number[]): boolean {
  for (let left = 0; left < hours.length; left += 1) {
    for (let right = left + 1; right < hours.length; right += 1) {
      const difference = Math.abs(hours[left] - hours[right]);
      if (Math.min(difference, 24 - difference) < MIN_HOURS_BETWEEN_SYNCS) return false;
    }
  }
  return true;
}

export function normalizeGarminSyncHours(value: unknown): number[] | null {
  let source = value;
  if (typeof value === "string") {
    try { source = JSON.parse(value); } catch { return null; }
  }
  if (!Array.isArray(source) || source.length > MAX_SYNCS_PER_DAY) return null;
  if (!source.every((hour) => Number.isInteger(hour) && hour >= 0 && hour <= 23)) return null;
  const hours = [...new Set(source as number[])].sort((left, right) => left - right);
  if (hours.length !== source.length || !hasValidSpacing(hours)) return null;
  return hours;
}

function scheduleFromRow(row: ScheduleRow | null): GarminSyncSchedule {
  return {
    enabled: row?.enabled === null || row?.enabled === undefined ? true : row.enabled === 1,
    syncHours: normalizeGarminSyncHours(row?.syncHours) ?? [...DEFAULT_SYNC_HOURS],
    timeZone: TIME_ZONE,
  };
}

async function readSchedule(env: Env, userId: string): Promise<GarminSyncSchedule> {
  const row = await env.DB.prepare(
    `SELECT garmin_sync_enabled AS enabled,
            garmin_sync_hours AS syncHours
     FROM user_settings
     WHERE user_id = ?`,
  ).bind(userId).first<ScheduleRow>();
  return scheduleFromRow(row);
}

export async function handleGarminScheduleRoute(request: Request, env: Env): Promise<Response | null> {
  if (new URL(request.url).pathname !== "/api/garmin/schedule") return null;
  const user = await getAuthenticatedUser(request, env.DB);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });

  if (request.method === "GET") return json({ schedule: await readSchedule(env, user.id) });
  if (request.method !== "PUT") return json({ error: "method_not_allowed" }, { status: 405 });
  if (user.role === "viewer") return json({ error: "forbidden" }, { status: 403 });

  let body: { enabled?: unknown; syncHours?: unknown };
  try { body = await request.json(); } catch { return json({ error: "invalid_json" }, { status: 400 }); }
  if (typeof body.enabled !== "boolean") return json({ error: "invalid_garmin_sync_enabled" }, { status: 400 });
  const syncHours = normalizeGarminSyncHours(body.syncHours);
  if (syncHours === null || syncHours.length === 0) {
    return json({ error: "invalid_garmin_sync_hours" }, { status: 400 });
  }

  const updatedAt = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO user_settings (user_id, garmin_sync_enabled, garmin_sync_hours, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       garmin_sync_enabled = excluded.garmin_sync_enabled,
       garmin_sync_hours = excluded.garmin_sync_hours,
       updated_at = excluded.updated_at`,
  ).bind(user.id, body.enabled ? 1 : 0, JSON.stringify(syncHours), updatedAt).run();

  return json({ schedule: { enabled: body.enabled, syncHours, timeZone: TIME_ZONE } satisfies GarminSyncSchedule });
}

export async function queueScheduledGarminSyncs(env: Env, now = new Date()): Promise<ScheduledSyncResult> {
  const localHour = copenhagenHour(now);
  const agent = await env.DB.prepare(
    `SELECT id
     FROM garmin_agents
     WHERE revoked_at IS NULL
     ORDER BY last_seen_at DESC, created_at DESC
     LIMIT 1`,
  ).first<{ id: string }>();

  if (!agent) {
    return { queued: 0, skippedActive: 0, skippedRecent: 0, eligible: 0, configured: 0, localHour, reason: "garmin_agent_not_configured" };
  }

  const credentials = await env.DB.prepare(
    `SELECT c.user_id AS userId,
            s.garmin_sync_enabled AS enabled,
            s.garmin_sync_hours AS syncHours
     FROM garmin_credentials c
     LEFT JOIN user_settings s ON s.user_id = c.user_id
     ORDER BY c.user_id`,
  ).all<ScheduledUserRow>();

  const nowIso = now.toISOString();
  const recentCutoff = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
  let queued = 0;
  let skippedActive = 0;
  let skippedRecent = 0;
  let eligible = 0;
  let configured = 0;

  for (const row of credentials.results) {
    const schedule = scheduleFromRow(row);
    if (!schedule.enabled) continue;
    configured += 1;
    if (!schedule.syncHours.includes(localHour)) continue;
    eligible += 1;

    const active = await env.DB.prepare(
      `SELECT id
       FROM garmin_sync_jobs
       WHERE user_id = ? AND status IN ('queued','running','processing')
       ORDER BY requested_at DESC
       LIMIT 1`,
    ).bind(row.userId).first();
    if (active) {
      skippedActive += 1;
      continue;
    }

    const recentComplete = await env.DB.prepare(
      `SELECT id
       FROM garmin_sync_jobs
       WHERE user_id = ? AND status = 'complete' AND requested_at >= ?
       ORDER BY requested_at DESC
       LIMIT 1`,
    ).bind(row.userId, recentCutoff).first();
    if (recentComplete) {
      skippedRecent += 1;
      continue;
    }

    const id = crypto.randomUUID();
    const label = String(localHour).padStart(2, "0");
    const result = await env.DB.prepare(
      `INSERT INTO garmin_sync_jobs (id, user_id, agent_id, status, message, requested_at, updated_at)
       VALUES (?, ?, ?, 'queued', ?, ?, ?)`,
    ).bind(id, row.userId, agent.id, `Planlagt Garmin-synkronisering · kl. ${label}`, nowIso, nowIso).run();
    if (result.meta.changes) queued += 1;
  }

  return { queued, skippedActive, skippedRecent, eligible, configured, localHour };
}
