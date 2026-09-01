import { readZipTextEntries } from "./zip-inventory";

type SleepRow = {
  date: string;
  import_id: string | null;
  sleep_start_ms: number | null;
  sleep_end_ms: number | null;
  sleep_start_display_ms: number | null;
  sleep_end_display_ms: number | null;
  sleep_seconds: number | null;
  nap_seconds: number | null;
  deep_seconds: number | null;
  light_seconds: number | null;
  rem_seconds: number | null;
  awake_seconds: number | null;
  avg_respiration: number | null;
  low_respiration: number | null;
  high_respiration: number | null;
};

type ImportRow = { storageKey: string | null };
type FileRow = { path: string };
type RawPoint = Record<string, unknown>;
type DateRow = { date: string };

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function num(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function timestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : `${value}Z`;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function pointList(value: unknown): RawPoint[] {
  return Array.isArray(value) ? value.filter((item): item is RawPoint => object(item) !== null) : [];
}

function normalizeStage(value: unknown): "deep" | "light" | "rem" | "awake" | null {
  const level = num(value);
  if (level === 0) return "deep";
  if (level === 1) return "light";
  if (level === 2) return "rem";
  if (level === 3) return "awake";
  return null;
}

function normalizeSeries(value: unknown, valueKey: string, timeKey = "startGMT") {
  return pointList(value).map((item) => ({
    time: timestamp(item[timeKey]),
    value: num(item[valueKey]),
  })).filter((item): item is { time: number; value: number } => item.time !== null && item.value !== null);
}

const SELECT_SLEEP = `date, import_id, sleep_start_ms, sleep_end_ms,
  sleep_start_display_ms, sleep_end_display_ms, sleep_seconds, nap_seconds,
  deep_seconds, light_seconds, rem_seconds, awake_seconds,
  avg_respiration, low_respiration, high_respiration`;

export async function getSleepDetail(env: Env, userId: string, requestedDate: string | null, days = 30) {
  const safeDays = Math.max(1, Math.min(365, Math.trunc(days) || 30));
  const historyResult = await env.DB.prepare(
    `SELECT ${SELECT_SLEEP}
     FROM garmin_sleep
     WHERE user_id = ?
     ORDER BY date DESC
     LIMIT ?`,
  ).bind(userId, safeDays).all<SleepRow>();

  const rawHistory = historyResult.results;
  if (rawHistory.length === 0) return { selected: null, history: [], navigation: { previousDate: null, nextDate: null } };
  const rawSelected = (requestedDate ? rawHistory.find((row) => row.date === requestedDate) : null)
    ?? (requestedDate
      ? await env.DB.prepare(`SELECT ${SELECT_SLEEP} FROM garmin_sleep WHERE user_id = ? AND date = ?`)
        .bind(userId, requestedDate).first<SleepRow>()
      : rawHistory[0]);

  if (!rawSelected) return { selected: null, history: [...rawHistory].reverse(), navigation: { previousDate: null, nextDate: null } };

  const [previousRow, nextRow] = await Promise.all([
    env.DB.prepare(`SELECT date FROM garmin_sleep WHERE user_id = ? AND date < ? AND sleep_seconds > 0 ORDER BY date DESC LIMIT 1`)
      .bind(userId, rawSelected.date).first<DateRow>(),
    env.DB.prepare(`SELECT date FROM garmin_sleep WHERE user_id = ? AND date > ? AND sleep_seconds > 0 ORDER BY date ASC LIMIT 1`)
      .bind(userId, rawSelected.date).first<DateRow>(),
  ]);

  let detail: Record<string, unknown> | null = null;

  if (rawSelected.import_id) {
    const [importRow, fileRow] = await Promise.all([
      env.DB.prepare(`SELECT storage_key AS storageKey FROM garmin_imports WHERE id = ? AND user_id = ?`)
        .bind(rawSelected.import_id, userId).first<ImportRow>(),
      env.DB.prepare(
        `SELECT path FROM garmin_import_files
         WHERE import_id = ? AND path LIKE ?
         ORDER BY CASE WHEN path = ? THEN 0 ELSE 1 END, path
         LIMIT 1`,
      ).bind(rawSelected.import_id, `%Sleep/sleep_${rawSelected.date}.json`, `Sleep/sleep_${rawSelected.date}.json`).first<FileRow>(),
    ]);

    if (importRow?.storageKey && fileRow?.path) {
      const files = await readZipTextEntries(env.DATA, importRow.storageKey, [fileRow.path]);
      const text = files.get(fileRow.path);
      if (text) {
        const raw = object(JSON.parse(text));
        const dto = object(raw?.dailySleepDTO);
        const gmtStart = num(dto?.sleepStartTimestampGMT) ?? rawSelected.sleep_start_ms;
        const gmtEnd = num(dto?.sleepEndTimestampGMT) ?? rawSelected.sleep_end_ms;
        const localStart = num(dto?.sleepStartTimestampLocal);
        const localEnd = num(dto?.sleepEndTimestampLocal);

        // Keep Garmin's GMT timestamps as real instants. The client formats them in
        // Europe/Copenhagen, which handles both local time and DST correctly. The
        // Garmin "Local" fields are wall-clock encoded values and must not be added
        // as an offset; doing so can shift sleep by several hours.
        const stages = pointList(raw?.sleepLevels).map((item) => {
          const start = timestamp(item.startGMT);
          const end = timestamp(item.endGMT);
          return {
            start,
            end,
            stage: normalizeStage(item.activityLevel),
          };
        }).filter((item): item is { start: number; end: number; stage: "deep" | "light" | "rem" | "awake" } => (
          item.start !== null && item.end !== null && item.end > item.start && item.stage !== null
        ));

        detail = {
          sleepStartMs: gmtStart,
          sleepEndMs: gmtEnd,
          localStartRawMs: localStart,
          localEndRawMs: localEnd,
          bodyBatteryChange: num(raw?.bodyBatteryChange),
          restingHeartRate: num(raw?.restingHeartRate),
          stages,
          heartRate: normalizeSeries(raw?.sleepHeartRate, "value"),
          stress: normalizeSeries(raw?.sleepStress, "value"),
          bodyBattery: normalizeSeries(raw?.sleepBodyBattery, "value"),
          respiration: normalizeSeries(raw?.wellnessEpochRespirationDataDTOList, "respirationValue", "startTimeGMT"),
        };
      }
    }
  }

  return {
    selected: { ...rawSelected, detail },
    history: [...rawHistory].reverse(),
    navigation: {
      previousDate: previousRow?.date ?? null,
      nextDate: nextRow?.date ?? null,
    },
  };
}
