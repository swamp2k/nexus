import { readZipTextEntries } from "./zip-inventory";

type SleepRow = {
  date: string;
  import_id: string | null;
  sleep_start_ms: number | null;
  sleep_end_ms: number | null;
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

function timezoneOffsetMs(epochMs: number, timeZone = "Europe/Copenhagen"): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(new Date(epochMs));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), Number(map.hour), Number(map.minute), Number(map.second));
  return asUtc - Math.floor(epochMs / 1000) * 1000;
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

function normalizeSeries(value: unknown, valueKey: string, offsetMs: number, timeKey = "startGMT") {
  return pointList(value).map((item) => {
    const time = timestamp(item[timeKey]);
    return {
      time: time === null ? null : time + offsetMs,
      value: num(item[valueKey]),
    };
  }).filter((item): item is { time: number; value: number } => item.time !== null && item.value !== null);
}

function shiftRow(row: SleepRow, offsetMs: number): SleepRow {
  return {
    ...row,
    sleep_start_ms: row.sleep_start_ms === null ? null : row.sleep_start_ms + offsetMs,
    sleep_end_ms: row.sleep_end_ms === null ? null : row.sleep_end_ms + offsetMs,
  };
}

export async function getSleepDetail(env: Env, userId: string, requestedDate: string | null, days = 30) {
  const safeDays = Math.max(1, Math.min(365, Math.trunc(days) || 30));
  const historyResult = await env.DB.prepare(
    `SELECT date, import_id, sleep_start_ms, sleep_end_ms, sleep_seconds, nap_seconds,
            deep_seconds, light_seconds, rem_seconds, awake_seconds,
            avg_respiration, low_respiration, high_respiration
     FROM garmin_sleep
     WHERE user_id = ?
     ORDER BY date DESC
     LIMIT ?`,
  ).bind(userId, safeDays).all<SleepRow>();

  const rawHistory = historyResult.results;
  if (rawHistory.length === 0) return { selected: null, history: [] };
  const rawSelected = (requestedDate ? rawHistory.find((row) => row.date === requestedDate) : null)
    ?? (requestedDate
      ? await env.DB.prepare(
        `SELECT date, import_id, sleep_start_ms, sleep_end_ms, sleep_seconds, nap_seconds,
                deep_seconds, light_seconds, rem_seconds, awake_seconds,
                avg_respiration, low_respiration, high_respiration
         FROM garmin_sleep WHERE user_id = ? AND date = ?`,
      ).bind(userId, requestedDate).first<SleepRow>()
      : rawHistory[0]);

  if (!rawSelected) return { selected: null, history: [...rawHistory].reverse() };

  let detail: Record<string, unknown> | null = null;
  let displayOffsetMs = 0;
  if (rawSelected.import_id) {
    const [importRow, fileRow] = await Promise.all([
      env.DB.prepare(
        `SELECT storage_key AS storageKey FROM garmin_imports WHERE id = ? AND user_id = ?`,
      ).bind(rawSelected.import_id, userId).first<ImportRow>(),
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
        const localStart = num(dto?.sleepStartTimestampLocal);
        const gmtEnd = num(dto?.sleepEndTimestampGMT) ?? rawSelected.sleep_end_ms;
        const localEnd = num(dto?.sleepEndTimestampLocal);
        if (gmtStart !== null && localStart !== null) {
          // Garmin's Local timestamps encode wall-clock time as if it were UTC.
          // Shift the actual GMT series just enough that normal Copenhagen rendering
          // lands on the same wall-clock values Garmin Connect displays.
          displayOffsetMs = localStart - gmtStart - timezoneOffsetMs(gmtStart);
        }

        const stages = pointList(raw?.sleepLevels).map((item) => {
          const start = timestamp(item.startGMT);
          const end = timestamp(item.endGMT);
          return {
            start: start === null ? null : start + displayOffsetMs,
            end: end === null ? null : end + displayOffsetMs,
            stage: normalizeStage(item.activityLevel),
          };
        }).filter((item): item is { start: number; end: number; stage: "deep" | "light" | "rem" | "awake" } => (
          item.start !== null && item.end !== null && item.end > item.start && item.stage !== null
        ));

        detail = {
          sleepStartMs: localStart ?? (gmtStart === null ? null : gmtStart + displayOffsetMs),
          sleepEndMs: localEnd ?? (gmtEnd === null ? null : gmtEnd + displayOffsetMs),
          displayOffsetMs,
          bodyBatteryChange: num(raw?.bodyBatteryChange),
          restingHeartRate: num(raw?.restingHeartRate),
          stages,
          heartRate: normalizeSeries(raw?.sleepHeartRate, "value", displayOffsetMs),
          stress: normalizeSeries(raw?.sleepStress, "value", displayOffsetMs),
          bodyBattery: normalizeSeries(raw?.sleepBodyBattery, "value", displayOffsetMs),
          respiration: normalizeSeries(raw?.wellnessEpochRespirationDataDTOList, "respirationValue", displayOffsetMs, "startTimeGMT"),
        };
      }
    }
  }

  const history = rawHistory.map((row) => shiftRow(row, displayOffsetMs));
  const selected = shiftRow(rawSelected, displayOffsetMs);

  return {
    selected: { ...selected, detail },
    history: [...history].reverse(),
  };
}
