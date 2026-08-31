type HealthRow = {
  date: string;
  steps: number | null;
  step_goal: number | null;
  distance_m: number | null;
  total_calories: number | null;
  active_calories: number | null;
  resting_hr: number | null;
  min_hr: number | null;
  max_hr: number | null;
  avg_stress: number | null;
  max_stress: number | null;
  body_battery_high: number | null;
  body_battery_low: number | null;
  body_battery_charged: number | null;
  body_battery_drained: number | null;
  body_battery_latest: number | null;
  waking_respiration: number | null;
  sleeping_respiration: number | null;
};

function clampDays(value: number): number {
  if (!Number.isFinite(value)) return 7;
  return Math.max(1, Math.min(365, Math.round(value)));
}

export async function getHealthDetail(db: D1Database, userId: string, requestedDate: string | null, requestedDays: number) {
  const days = clampDays(requestedDays);
  const latest = await db.prepare(
    `SELECT date FROM garmin_daily WHERE user_id = ? ORDER BY date DESC LIMIT 1`,
  ).bind(userId).first<{ date: string }>();

  const date = requestedDate ?? latest?.date ?? null;
  if (!date) return { selected: null, history: [], navigation: { previousDate: null, nextDate: null } };

  const selected = await db.prepare(
    `SELECT d.date, d.steps, d.step_goal, d.distance_m, d.total_calories, d.active_calories,
            COALESCE(r.resting_hr, d.resting_hr) AS resting_hr, d.min_hr, d.max_hr,
            d.avg_stress, d.max_stress,
            d.body_battery_high, d.body_battery_low, d.body_battery_charged,
            d.body_battery_drained, d.body_battery_latest, d.waking_respiration,
            s.avg_respiration AS sleeping_respiration
       FROM garmin_daily d
       LEFT JOIN garmin_rhr r ON r.user_id = d.user_id AND r.date = d.date
       LEFT JOIN garmin_sleep s ON s.user_id = d.user_id AND s.date = d.date
      WHERE d.user_id = ? AND d.date = ?`,
  ).bind(userId, date).first<HealthRow>();

  const historyResult = await db.prepare(
    `SELECT * FROM (
       SELECT d.date, d.steps, d.step_goal, d.distance_m, d.total_calories, d.active_calories,
              COALESCE(r.resting_hr, d.resting_hr) AS resting_hr, d.min_hr, d.max_hr,
              d.avg_stress, d.max_stress,
              d.body_battery_high, d.body_battery_low, d.body_battery_charged,
              d.body_battery_drained, d.body_battery_latest, d.waking_respiration,
              s.avg_respiration AS sleeping_respiration
         FROM garmin_daily d
         LEFT JOIN garmin_rhr r ON r.user_id = d.user_id AND r.date = d.date
         LEFT JOIN garmin_sleep s ON s.user_id = d.user_id AND s.date = d.date
        WHERE d.user_id = ? AND d.date <= ?
        ORDER BY d.date DESC
        LIMIT ?
     ) ORDER BY date ASC`,
  ).bind(userId, date, days).all<HealthRow>();

  const previous = await db.prepare(
    `SELECT date FROM garmin_daily WHERE user_id = ? AND date < ? ORDER BY date DESC LIMIT 1`,
  ).bind(userId, date).first<{ date: string }>();
  const next = await db.prepare(
    `SELECT date FROM garmin_daily WHERE user_id = ? AND date > ? ORDER BY date ASC LIMIT 1`,
  ).bind(userId, date).first<{ date: string }>();

  return {
    selected: selected ?? null,
    history: historyResult.results,
    navigation: { previousDate: previous?.date ?? null, nextDate: next?.date ?? null },
  };
}
