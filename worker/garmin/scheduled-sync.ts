const TIME_ZONE = "Europe/Copenhagen";

type ScheduledSyncResult = {
  queued: number;
  skippedActive: number;
  skippedRecent: number;
  eligible: number;
  reason?: string;
};

function copenhagenHour(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Number(parts.find((part) => part.type === "hour")?.value ?? -1);
}

export function shouldRunScheduledGarminSync(date = new Date()): boolean {
  return copenhagenHour(date) === 9;
}

export async function queueScheduledGarminSyncs(env: Env): Promise<ScheduledSyncResult> {
  const agent = await env.DB.prepare(
    `SELECT id
     FROM garmin_agents
     WHERE revoked_at IS NULL
     ORDER BY last_seen_at DESC, created_at DESC
     LIMIT 1`,
  ).first<{ id: string }>();

  if (!agent) return { queued: 0, skippedActive: 0, skippedRecent: 0, eligible: 0, reason: "garmin_agent_not_configured" };

  const credentials = await env.DB.prepare(
    `SELECT user_id AS userId
     FROM garmin_credentials
     ORDER BY user_id`,
  ).all<{ userId: string }>();

  const now = new Date();
  const nowIso = now.toISOString();
  const recentCutoff = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
  let queued = 0;
  let skippedActive = 0;
  let skippedRecent = 0;

  for (const row of credentials.results) {
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
    const result = await env.DB.prepare(
      `INSERT INTO garmin_sync_jobs (id, user_id, agent_id, status, message, requested_at, updated_at)
       VALUES (?, ?, ?, 'queued', 'Planlagt Garmin-synkronisering · kl. 09', ?, ?)`,
    ).bind(id, row.userId, agent.id, nowIso, nowIso).run();
    if (result.meta.changes) queued += 1;
  }

  return {
    queued,
    skippedActive,
    skippedRecent,
    eligible: credentials.results.length,
  };
}
