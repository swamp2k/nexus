import { readZipTextEntries } from "./zip-inventory";

const BATCH_SIZE = 20;

type ImportFileRow = { id: string; path: string };
type ImportRow = { storageKey: string | null };

type ProcessResult = {
  processed: number;
  failed: number;
  remaining: boolean;
  completed: boolean;
};

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function num(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function dateFromPath(path: string): string | null {
  return path.match(/(20\d{2}-\d{2}-\d{2})/)?.[1] ?? null;
}

function supported(path: string): boolean {
  return /(?:^|\/)daily_summary_20\d{2}-\d{2}-\d{2}\.json$/.test(path)
    || /^Sleep\/sleep_20\d{2}-\d{2}-\d{2}\.json$/.test(path)
    || /^RHR\/rhr_20\d{2}-\d{2}-\d{2}\.json$/.test(path)
    || /^Weight\/weight_20\d{2}-\d{2}-\d{2}\.json$/.test(path)
    || /(?:^|\/)activity_\d+\.json$/.test(path);
}

async function upsertDaily(db: D1Database, userId: string, importId: string, value: unknown, path: string) {
  const row = object(value);
  const date = str(row?.calendarDate) ?? dateFromPath(path);
  if (!row || !date) throw new Error("daily_summary_invalid");
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO garmin_daily (
       user_id, date, import_id, steps, step_goal, distance_m, total_calories, active_calories,
       resting_hr, min_hr, max_hr, avg_stress, max_stress, body_battery_high, body_battery_low,
       body_battery_charged, body_battery_drained, body_battery_latest, waking_respiration,
       sleeping_seconds, active_seconds, sedentary_seconds, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, date) DO UPDATE SET
       import_id=excluded.import_id, steps=excluded.steps, step_goal=excluded.step_goal,
       distance_m=excluded.distance_m, total_calories=excluded.total_calories, active_calories=excluded.active_calories,
       resting_hr=excluded.resting_hr, min_hr=excluded.min_hr, max_hr=excluded.max_hr,
       avg_stress=excluded.avg_stress, max_stress=excluded.max_stress,
       body_battery_high=excluded.body_battery_high, body_battery_low=excluded.body_battery_low,
       body_battery_charged=excluded.body_battery_charged, body_battery_drained=excluded.body_battery_drained,
       body_battery_latest=excluded.body_battery_latest, waking_respiration=excluded.waking_respiration,
       sleeping_seconds=excluded.sleeping_seconds, active_seconds=excluded.active_seconds,
       sedentary_seconds=excluded.sedentary_seconds, updated_at=excluded.updated_at`,
  ).bind(
    userId, date, importId,
    num(row.totalSteps), num(row.dailyStepGoal), num(row.totalDistanceMeters), num(row.totalKilocalories), num(row.activeKilocalories),
    num(row.restingHeartRate), num(row.minHeartRate), num(row.maxHeartRate), num(row.averageStressLevel), num(row.maxStressLevel),
    num(row.bodyBatteryHighestValue), num(row.bodyBatteryLowestValue), num(row.bodyBatteryChargedValue), num(row.bodyBatteryDrainedValue),
    num(row.bodyBatteryMostRecentValue), num(row.avgWakingRespirationValue), num(row.sleepingSeconds), num(row.activeSeconds),
    num(row.sedentarySeconds), now,
  ).run();
}

async function upsertSleep(db: D1Database, userId: string, importId: string, value: unknown, path: string) {
  const root = object(value);
  const dto = object(root?.dailySleepDTO);
  const date = str(dto?.calendarDate) ?? dateFromPath(path);
  if (!dto || !date) throw new Error("sleep_invalid");
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO garmin_sleep (
       user_id, date, import_id, sleep_start_ms, sleep_end_ms, sleep_seconds, nap_seconds,
       deep_seconds, light_seconds, rem_seconds, awake_seconds, avg_respiration, low_respiration,
       high_respiration, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, date) DO UPDATE SET
       import_id=excluded.import_id, sleep_start_ms=excluded.sleep_start_ms, sleep_end_ms=excluded.sleep_end_ms,
       sleep_seconds=excluded.sleep_seconds, nap_seconds=excluded.nap_seconds, deep_seconds=excluded.deep_seconds,
       light_seconds=excluded.light_seconds, rem_seconds=excluded.rem_seconds, awake_seconds=excluded.awake_seconds,
       avg_respiration=excluded.avg_respiration, low_respiration=excluded.low_respiration,
       high_respiration=excluded.high_respiration, updated_at=excluded.updated_at`,
  ).bind(
    userId, date, importId, num(dto.sleepStartTimestampGMT), num(dto.sleepEndTimestampGMT), num(dto.sleepTimeSeconds),
    num(dto.napTimeSeconds), num(dto.deepSleepSeconds), num(dto.lightSleepSeconds), num(dto.remSleepSeconds),
    num(dto.awakeSleepSeconds), num(dto.averageRespirationValue), num(dto.lowestRespirationValue),
    num(dto.highestRespirationValue), now,
  ).run();
}

async function upsertRhr(db: D1Database, userId: string, importId: string, value: unknown, path: string) {
  const root = object(value);
  const allMetrics = object(root?.allMetrics);
  const metricsMap = object(allMetrics?.metricsMap);
  const values = Array.isArray(metricsMap?.WELLNESS_RESTING_HEART_RATE) ? metricsMap.WELLNESS_RESTING_HEART_RATE : [];
  const metric = object(values.at(-1));
  const date = str(metric?.calendarDate) ?? str(root?.statisticsStartDate) ?? dateFromPath(path);
  if (!date) throw new Error("rhr_invalid");
  await db.prepare(
    `INSERT INTO garmin_rhr (user_id, date, import_id, resting_hr, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, date) DO UPDATE SET
       import_id=excluded.import_id, resting_hr=excluded.resting_hr, updated_at=excluded.updated_at`,
  ).bind(userId, date, importId, num(metric?.value), new Date().toISOString()).run();
}

async function upsertWeight(db: D1Database, userId: string, importId: string, value: unknown, path: string) {
  const root = object(value);
  const list = Array.isArray(root?.dateWeightList) ? root.dateWeightList : [];
  const measurement = object(list.at(-1)) ?? object(root?.totalAverage);
  const date = str(root?.startDate) ?? dateFromPath(path);
  if (!root || !date) throw new Error("weight_invalid");
  await db.prepare(
    `INSERT INTO garmin_weight (
       user_id, date, import_id, weight_kg, bmi, body_fat_pct, body_water_pct, bone_mass_kg,
       muscle_mass_kg, visceral_fat, metabolic_age, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, date) DO UPDATE SET
       import_id=excluded.import_id, weight_kg=excluded.weight_kg, bmi=excluded.bmi,
       body_fat_pct=excluded.body_fat_pct, body_water_pct=excluded.body_water_pct,
       bone_mass_kg=excluded.bone_mass_kg, muscle_mass_kg=excluded.muscle_mass_kg,
       visceral_fat=excluded.visceral_fat, metabolic_age=excluded.metabolic_age, updated_at=excluded.updated_at`,
  ).bind(
    userId, date, importId, num(measurement?.weight), num(measurement?.bmi), num(measurement?.bodyFat),
    num(measurement?.bodyWater), num(measurement?.boneMass), num(measurement?.muscleMass),
    num(measurement?.visceralFat), num(measurement?.metabolicAge), new Date().toISOString(),
  ).run();
}

async function upsertActivity(db: D1Database, userId: string, importId: string, value: unknown) {
  const row = object(value);
  const activityId = row?.activityId === undefined || row.activityId === null ? null : String(row.activityId);
  if (!row || !activityId) throw new Error("activity_invalid");
  const activityType = object(row.activityType);
  await db.prepare(
    `INSERT INTO garmin_activities (
       user_id, activity_id, import_id, activity_uuid, name, type, start_time_local, start_time_gmt,
       duration_seconds, moving_seconds, distance_m, calories, avg_hr, max_hr, steps, elevation_gain_m,
       elevation_loss_m, vo2max, location_name, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, activity_id) DO UPDATE SET
       import_id=excluded.import_id, activity_uuid=excluded.activity_uuid, name=excluded.name, type=excluded.type,
       start_time_local=excluded.start_time_local, start_time_gmt=excluded.start_time_gmt,
       duration_seconds=excluded.duration_seconds, moving_seconds=excluded.moving_seconds, distance_m=excluded.distance_m,
       calories=excluded.calories, avg_hr=excluded.avg_hr, max_hr=excluded.max_hr, steps=excluded.steps,
       elevation_gain_m=excluded.elevation_gain_m, elevation_loss_m=excluded.elevation_loss_m,
       vo2max=excluded.vo2max, location_name=excluded.location_name, updated_at=excluded.updated_at`,
  ).bind(
    userId, activityId, importId, str(row.activityUUID), str(row.activityName), str(activityType?.typeKey),
    str(row.startTimeLocal), str(row.startTimeGMT), num(row.duration), num(row.movingDuration), num(row.distance),
    num(row.calories), num(row.averageHR), num(row.maxHR), num(row.steps), num(row.elevationGain), num(row.elevationLoss),
    num(row.vO2MaxValue), str(row.locationName), new Date().toISOString(),
  ).run();
}

async function parseOne(db: D1Database, userId: string, importId: string, path: string, text: string) {
  const value = JSON.parse(text) as unknown;
  if (/(?:^|\/)daily_summary_/.test(path)) return upsertDaily(db, userId, importId, value, path);
  if (path.startsWith("Sleep/sleep_")) return upsertSleep(db, userId, importId, value, path);
  if (path.startsWith("RHR/rhr_")) return upsertRhr(db, userId, importId, value, path);
  if (path.startsWith("Weight/weight_")) return upsertWeight(db, userId, importId, value, path);
  if (/(?:^|\/)activity_\d+\.json$/.test(path)) return upsertActivity(db, userId, importId, value);
  throw new Error("unsupported_garmindb_file");
}

export async function processGarminDbBatch(env: Env, userId: string, importId: string): Promise<ProcessResult> {
  const importRow = await env.DB.prepare(
    `SELECT storage_key AS storageKey FROM garmin_imports WHERE id = ? AND user_id = ?`,
  ).bind(importId, userId).first<ImportRow>();
  if (!importRow?.storageKey) throw new Error("import_not_found");

  const candidates = await env.DB.prepare(
    `SELECT id, path FROM garmin_import_files
     WHERE import_id = ? AND status = 'discovered' AND file_type = 'json'
     ORDER BY path LIMIT 5000`,
  ).bind(importId).all<ImportFileRow>();

  const batch = candidates.results.filter((row) => supported(row.path)).slice(0, BATCH_SIZE);
  if (batch.length === 0) {
    await env.DB.prepare(
      `UPDATE garmin_imports SET status = 'complete', error_message = NULL, updated_at = ?
       WHERE id = ? AND user_id = ?`,
    ).bind(new Date().toISOString(), importId, userId).run();
    return { processed: 0, failed: 0, remaining: false, completed: true };
  }

  await env.DB.prepare(
    `UPDATE garmin_imports SET status = 'processing', error_message = NULL, updated_at = ?
     WHERE id = ? AND user_id = ?`,
  ).bind(new Date().toISOString(), importId, userId).run();

  const texts = await readZipTextEntries(env.DATA, importRow.storageKey, batch.map((row) => row.path));
  let processed = 0;
  let failed = 0;

  for (const file of batch) {
    try {
      const text = texts.get(file.path);
      if (text === undefined) throw new Error("zip_entry_missing");
      await parseOne(env.DB, userId, importId, file.path, text);
      await env.DB.prepare(`UPDATE garmin_import_files SET status = 'parsed' WHERE id = ?`).bind(file.id).run();
      processed += 1;
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : "garmin_file_parse_failed";
      await env.DB.prepare(`UPDATE garmin_import_files SET status = 'error' WHERE id = ?`).bind(file.id).run();
      console.error(JSON.stringify({ event: "garmin_file_parse_failed", userId, importId, path: file.path, error: message }));
    }
  }

  const more = candidates.results.slice(batch.length).some((row) => supported(row.path));
  if (!more) {
    await env.DB.prepare(
      `UPDATE garmin_imports SET status = 'complete', error_message = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
    ).bind(failed > 0 ? `${failed} file(s) failed in final batch` : null, new Date().toISOString(), importId, userId).run();
  }

  return { processed, failed, remaining: more, completed: !more };
}

export async function getGarminOverview(db: D1Database, userId: string) {
  const [daily, sleep, rhr, activities, counts] = await Promise.all([
    db.prepare(`SELECT * FROM garmin_daily WHERE user_id = ? ORDER BY date DESC LIMIT 1`).bind(userId).first(),
    db.prepare(`SELECT * FROM garmin_sleep WHERE user_id = ? ORDER BY date DESC LIMIT 1`).bind(userId).first(),
    db.prepare(`SELECT * FROM garmin_rhr WHERE user_id = ? ORDER BY date DESC LIMIT 1`).bind(userId).first(),
    db.prepare(`SELECT * FROM garmin_activities WHERE user_id = ? ORDER BY COALESCE(start_time_gmt, start_time_local) DESC LIMIT 5`).bind(userId).all(),
    db.prepare(`SELECT
      (SELECT COUNT(*) FROM garmin_daily WHERE user_id = ?) AS dailyCount,
      (SELECT COUNT(*) FROM garmin_sleep WHERE user_id = ?) AS sleepCount,
      (SELECT COUNT(*) FROM garmin_activities WHERE user_id = ?) AS activityCount`).bind(userId, userId, userId).first(),
  ]);
  return { daily, sleep, rhr, activities: activities.results, counts };
}
