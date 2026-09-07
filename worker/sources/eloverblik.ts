import { readSourceCache, recordSourceError, writeSourceCache } from "./cache";
import type { EloverblikCredentials } from "./eloverblik-credentials";
import { readEloverblikAccessToken, storeEloverblikAccessToken } from "./eloverblik-credentials";

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const BASE_URL = "https://api.eloverblik.dk/CustomerApi";

type Point = {
  "out_Quantity.quantity"?: unknown;
  "out_Quantity.quality"?: unknown;
  position?: unknown;
};

type Period = {
  resolution?: unknown;
  timeInterval?: { start?: unknown; end?: unknown };
  Point?: unknown;
};

export type UsageDay = {
  date: string;
  kwh: number;
};

export type ElectricityUsageData = {
  source: "Eloverblik";
  days: UsageDay[];
  retainedHistory?: boolean;
};

async function getAccessToken(env: Env, userId: string, refreshToken: string): Promise<string> {
  const cached = await readEloverblikAccessToken(env, userId);
  if (cached) return cached;
  const response = await fetch(`${BASE_URL}/api/Token`, {
    signal: AbortSignal.timeout(30000),
    headers: {
      Authorization: `Bearer ${refreshToken}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) throw new Error(`eloverblik_token_http_${response.status}`);
  const body = await response.json() as { result?: unknown };
  if (typeof body.result !== "string" || body.result.length < 20) {
    throw new Error("eloverblik_invalid_token_response");
  }
  await storeEloverblikAccessToken(env, userId, body.result);
  return body.result;
}

export function localUsageDate(value: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Copenhagen", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
}

export function shiftUsageDate(date: string, days: number): string {
  const value = new Date(date + "T12:00:00Z");
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export type UsageRange = { from: string; to: string }; // to is exclusive

export function validUsageRange(from: string, to: string): boolean {
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  return validDate(from) && validDate(to) && from < to && to <= localUsageDate(new Date()) && (Date.parse(to) - Date.parse(from)) / 86400000 <= 366;
}

// Day aggregation: each position is one local calendar day, including DST days.
// Missing/incomplete quantities must never become zero or overwrite good history.
export function parseDays(payload: unknown): UsageDay[] {
  if (typeof payload !== "object" || payload === null) throw new Error("eloverblik_invalid_response");
  const result = (payload as { result?: unknown }).result;
  if (!Array.isArray(result)) throw new Error("eloverblik_invalid_response");
  const totals = new Map<string, number>();
  for (const item of result) {
    if (typeof item !== "object" || item === null) throw new Error("eloverblik_invalid_response");
    if ("success" in item && item.success === false) throw new Error("eloverblik_timeseries_failed");
    const document = (item as { MyEnergyData_MarketDocument?: unknown }).MyEnergyData_MarketDocument;
    if (typeof document !== "object" || document === null) throw new Error("eloverblik_invalid_document");
    const series = (document as { TimeSeries?: unknown }).TimeSeries;
    if (!Array.isArray(series)) throw new Error("eloverblik_invalid_series");
    for (const seriesItem of series) {
      if (typeof seriesItem !== "object" || seriesItem === null) continue;
      const unit = (seriesItem as Record<string, unknown>)["measurement_Unit.name"];
      if (unit !== "KWH") throw new Error("eloverblik_unsupported_unit");
      const periods = (seriesItem as { Period?: unknown }).Period;
      if (!Array.isArray(periods)) continue;
      for (const rawPeriod of periods) {
        if (typeof rawPeriod !== "object" || rawPeriod === null) continue;
        const period = rawPeriod as Period;
        const start = period.timeInterval?.start;
        if (period.resolution !== "P1D") throw new Error("eloverblik_unexpected_resolution");
        if (typeof start !== "string" || !Number.isFinite(Date.parse(start)) || !Array.isArray(period.Point)) continue;
        const firstDate = localUsageDate(new Date(start));
        for (const rawPoint of period.Point) {
          if (typeof rawPoint !== "object" || rawPoint === null) continue;
          const point = rawPoint as Point;
          const raw = point["out_Quantity.quantity"];
          const quality = point["out_Quantity.quality"];
          const position = Number(point.position);
          if (!Number.isInteger(position) || position < 1 || position > 366 || quality === "A02" || quality === "A05") continue;
          if ((typeof raw !== "string" && typeof raw !== "number") || String(raw).trim() === "") continue;
          const quantity = Number(raw);
          if (!Number.isFinite(quantity) || quantity < 0) continue;
          const date = shiftUsageDate(firstDate, position - 1);
          // One configured meter, so repeated periods are replacements, not extra usage.
          totals.set(date, quantity);
        }
      }
    }
  }
  return [...totals].map(([date, kwh]) => ({ date, kwh })).sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchUsage(env: Env, userId: string, credentials: EloverblikCredentials, range: UsageRange): Promise<ElectricityUsageData> {
  const accessToken = await getAccessToken(env, userId, credentials.refreshToken);
  const url = `${BASE_URL}/api/MeterData/GetTimeSeries/${range.from}/${range.to}/Day`;

  const response = await fetch(url, {
    signal: AbortSignal.timeout(30000),
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      meteringPoints: {
        meteringPoint: [credentials.meteringPoint],
      },
    }),
  });

  if (response.status === 401) await env.DB.prepare(`DELETE FROM source_cache WHERE source_key = ?`).bind(`energy:access:${userId}`).run();
  if (!response.ok) throw new Error(`eloverblik_timeseries_http_${response.status}`);
  const days = parseDays(await response.json() as unknown);

  return { source: "Eloverblik", days: days.filter(day => day.date >= range.from && day.date < range.to) };
}

export async function getElectricityUsage(env: Env, userId: string, credentials: EloverblikCredentials, requestedRange?: UsageRange) {
  const today = localUsageDate(new Date());
  const range = requestedRange ?? { from: shiftUsageDate(today, -10), to: today };
  const cacheKey = `energy:usage:v2:${userId}:${credentials.meteringPoint}:${range.from}:${range.to}`;
  const cached = await readSourceCache<ElectricityUsageData>(env.DB, cacheKey);
  const readHistory = async () => (await env.DB.prepare(
    `SELECT date, kwh, fetched_at FROM electricity_usage_days WHERE user_id = ? AND metering_point = ? AND date >= ? AND date < ? ORDER BY date`,
  ).bind(userId, credentials.meteringPoint, range.from, range.to).all<UsageDay & { fetched_at: string }>()).results;
  let history: Array<UsageDay & { fetched_at: string }>;
  try {
    history = await readHistory();
  } catch (error) {
    // Workers Builds can deploy before an operator applies the D1 migration.
    // Keep source-backed views working, without masking other database failures.
    if (!(error instanceof Error) || !error.message.includes("no such table: electricity_usage_days")) throw error;
    const temporaryKey = `${cacheKey}:pending-migration`;
    const temporary = await readSourceCache<ElectricityUsageData>(env.DB, temporaryKey);
    if (temporary && !temporary.stale) return temporary;
    try {
      return await writeSourceCache(env.DB, temporaryKey, await fetchUsage(env, userId, credentials, range), CACHE_TTL_MS);
    } catch (sourceError) {
      if (!temporary) throw sourceError;
      const message = sourceError instanceof Error ? sourceError.message : "eloverblik_fetch_failed";
      await recordSourceError(env.DB, temporaryKey, message);
      return { ...temporary, stale: true, lastErrorAt: new Date().toISOString(), lastErrorMessage: message };
    }
  }
  const data = () => ({ source: "Eloverblik" as const, days: history.map(({ date, kwh }) => ({ date, kwh })) });
  if (cached && !cached.stale) return { ...cached, data: data(), stale: Boolean(cached.data.retainedHistory) };
  // Reuse fresh daily records even if they were fetched through another range/widget.
  const expected = (Date.parse(range.to) - Date.parse(range.from)) / 86400000;
  if (history.length === expected && history.every(day => Date.parse(day.fetched_at) > Date.now() - CACHE_TTL_MS)) {
    const fetchedAt = history.reduce((oldest, day) => day.fetched_at < oldest ? day.fetched_at : oldest, history[0].fetched_at);
    return { data: data(), fetchedAt, expiresAt: new Date(Date.parse(fetchedAt) + CACHE_TTL_MS).toISOString(), stale: false, lastErrorAt: null, lastErrorMessage: null };
  }
  try {
    const fetchedAt = new Date().toISOString();
    const fresh = await fetchUsage(env, userId, credentials, range);
    for (let index = 0; index < fresh.days.length; index += 50) {
      await env.DB.batch(fresh.days.slice(index, index + 50).map(day => env.DB.prepare(
        `INSERT INTO electricity_usage_days (user_id, metering_point, date, kwh, fetched_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id, metering_point, date) DO UPDATE SET kwh = excluded.kwh, fetched_at = excluded.fetched_at
         WHERE excluded.fetched_at >= electricity_usage_days.fetched_at`,
      ).bind(userId, credentials.meteringPoint, day.date, day.kwh, fetchedAt)));
    }
    history = await readHistory();
    const received = new Set(fresh.days.map(day => day.date));
    const retainedHistory = history.some(day => !received.has(day.date));
    const result = await writeSourceCache(env.DB, cacheKey, { ...data(), retainedHistory }, CACHE_TTL_MS);
    return { ...result, stale: retainedHistory };
  } catch (error) {
    const message = error instanceof Error ? error.message : "eloverblik_fetch_failed";
    await recordSourceError(env.DB, cacheKey, message);
    if (history.length || cached) {
      const fetchedAt = cached?.fetchedAt ?? history.reduce((latest, day) => day.fetched_at > latest ? day.fetched_at : latest, "");
      return { data: data(), fetchedAt, expiresAt: cached?.expiresAt ?? fetchedAt, stale: true, lastErrorAt: new Date().toISOString(), lastErrorMessage: message };
    }
    throw error;
  }
}
