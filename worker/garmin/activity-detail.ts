export async function listActivities(db: D1Database, userId: string, limit = 100) {
  const safeLimit = Math.max(1, Math.min(250, Math.trunc(limit)));
  const result = await db.prepare(
    `SELECT * FROM garmin_activities
     WHERE user_id = ?
     ORDER BY COALESCE(start_time_gmt, start_time_local) DESC
     LIMIT ?`,
  ).bind(userId, safeLimit).all();

  const count = await db.prepare(
    `SELECT COUNT(*) AS activityCount FROM garmin_activities WHERE user_id = ?`,
  ).bind(userId).first<{ activityCount: number }>();

  return { activities: result.results, counts: { activityCount: Number(count?.activityCount ?? 0) } };
}

export async function getActivityDetail(db: D1Database, userId: string, activityId: string) {
  const activity = await db.prepare(
    `SELECT * FROM garmin_activities WHERE user_id = ? AND activity_id = ?`,
  ).bind(userId, activityId).first<Record<string, unknown>>();

  if (!activity) return null;

  const previous = await db.prepare(
    `SELECT activity_id, start_time_local, start_time_gmt, duration_seconds, moving_seconds,
            distance_m, avg_hr, max_hr, elevation_gain_m
     FROM garmin_activities
     WHERE user_id = ?
       AND type = ?
       AND COALESCE(start_time_gmt, start_time_local) < COALESCE(?, ?)
     ORDER BY COALESCE(start_time_gmt, start_time_local) DESC
     LIMIT 5`,
  ).bind(
    userId,
    activity.type,
    activity.start_time_gmt,
    activity.start_time_local,
  ).all();

  return {
    activity,
    previous: previous.results,
    track: null,
    laps: [],
    trackAvailable: false,
  };
}
