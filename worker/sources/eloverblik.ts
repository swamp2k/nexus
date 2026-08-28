import { readSourceCache, recordSourceError, writeSourceCache } from "./cache";

const CACHE_KEY = "energy:usage";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const BASE_URL = "https://api.eloverblik.dk/CustomerApi";

type EloverblikEnv = Env & {
  ELOVERBLIK_REFRESH_TOKEN?: string;
  ELOVERBLIK_METERING_POINT?: string;
};

type TokenResponse = {
  result?: unknown;
};

type Point = {
  "out_Quantity.quantity"?: unknown;
};

type Period = {
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
};

function configured(env: EloverblikEnv): env is EloverblikEnv & {
  ELOVERBLIK_REFRESH_TOKEN: string;
  ELOVERBLIK_METERING_POINT: string;
} {
  return Boolean(env.ELOVERBLIK_REFRESH_TOKEN && env.ELOVERBLIK_METERING_POINT);
}

async function getAccessToken(refreshToken: string): Promise<string> {
  const response = await fetch(`${BASE_URL}/api/Token`, {
    headers: {
      Authorization: `Bearer ${refreshToken}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) throw new Error(`eloverblik_token_http_${response.status}`);
  const body = await response.json() as TokenResponse;
  if (typeof body.result !== "string" || body.result.length < 20) {
    throw new Error("eloverblik_invalid_token_response");
  }
  return body.result;
}

function parseDays(payload: unknown): UsageDay[] {
  if (typeof payload !== "object" || payload === null) return [];
  const result = (payload as { result?: unknown }).result;
  if (!Array.isArray(result)) return [];

  const totals = new Map<string, number>();

  for (const item of result) {
    if (typeof item !== "object" || item === null) continue;
    const document = (item as { MyEnergyData_MarketDocument?: unknown }).MyEnergyData_MarketDocument;
    if (typeof document !== "object" || document === null) continue;
    const series = (document as { TimeSeries?: unknown }).TimeSeries;
    if (!Array.isArray(series)) continue;

    for (const seriesItem of series) {
      if (typeof seriesItem !== "object" || seriesItem === null) continue;
      const periods = (seriesItem as { Period?: unknown }).Period;
      if (!Array.isArray(periods)) continue;

      for (const rawPeriod of periods) {
        if (typeof rawPeriod !== "object" || rawPeriod === null) continue;
        const period = rawPeriod as Period;
        const start = period.timeInterval?.start;
        if (typeof start !== "string" || !Array.isArray(period.Point)) continue;

        let sum = 0;
        for (const rawPoint of period.Point) {
          if (typeof rawPoint !== "object" || rawPoint === null) continue;
          const quantity = Number((rawPoint as Point)["out_Quantity.quantity"]);
          if (Number.isFinite(quantity)) sum += quantity;
        }

        const date = start.slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          totals.set(date, (totals.get(date) ?? 0) + sum);
        }
      }
    }
  }

  return [...totals.entries()]
    .map(([date, kwh]) => ({ date, kwh }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchUsage(env: EloverblikEnv & {
  ELOVERBLIK_REFRESH_TOKEN: string;
  ELOVERBLIK_METERING_POINT: string;
}): Promise<ElectricityUsageData> {
  const accessToken = await getAccessToken(env.ELOVERBLIK_REFRESH_TOKEN);
  const from = new Date();
  from.setUTCDate(from.getUTCDate() - 10);
  const to = new Date();

  const fromDate = from.toISOString().slice(0, 10);
  const toDate = to.toISOString().slice(0, 10);
  const url = `${BASE_URL}/api/MeterData/GetTimeSeries/${fromDate}/${toDate}/Hour`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      meteringPoints: {
        meteringPoint: [env.ELOVERBLIK_METERING_POINT],
      },
    }),
  });

  if (!response.ok) throw new Error(`eloverblik_timeseries_http_${response.status}`);
  const body = await response.json() as unknown;
  const days = parseDays(body);
  if (days.length === 0) throw new Error("eloverblik_no_usage_data");

  return {
    source: "Eloverblik",
    days,
  };
}

export async function getElectricityUsage(env: EloverblikEnv) {
  const cached = await readSourceCache<ElectricityUsageData>(env.DB, CACHE_KEY);
  if (cached && !cached.stale) return cached;

  if (!configured(env)) {
    if (cached) return { ...cached, stale: true };
    return null;
  }

  try {
    const data = await fetchUsage(env);
    return await writeSourceCache(env.DB, CACHE_KEY, data, CACHE_TTL_MS);
  } catch (error) {
    const message = error instanceof Error ? error.message : "eloverblik_fetch_failed";
    await recordSourceError(env.DB, CACHE_KEY, message);
    if (cached) return { ...cached, stale: true, lastErrorAt: new Date().toISOString(), lastErrorMessage: message };
    throw error;
  }
}
