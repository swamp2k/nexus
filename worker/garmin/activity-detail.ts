export async function getActivityDetail(db: D1Database, userId: string, activityId: string) {
  const activity = await db.prepare(
    `SELECT * FROM garmin_activities WHERE user_id = ? AND activity_id = ?`,
  ).bind(userId, activityId).first();

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
