import { readSourceCache, recordSourceError, writeSourceCache } from "./cache";

const CACHE_KEY = "energy:day-ahead";
const CACHE_TTL_MS = 60 * 60 * 1000;
const EUR_DKK_REFERENCE = 7.46038;

type PriceRecord = {
  TimeUTC?: unknown;
  DayAheadPriceEUR?: unknown;
};

type EnergyDataResponse = {
  records?: unknown;
};

export type EnergyPricePoint = {
  timeUtc: string;
  eurPerMwh: number;
  approxDkkPerKwh: number;
};

export type EnergyPriceData = {
  source: "Energi Data Service";
  area: string;
  resolutionMinutes: 15;
  currencyNote: string;
  intervals: EnergyPricePoint[];
};

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function cleanRecord(record: unknown): EnergyPricePoint | null {
  if (typeof record !== "object" || record === null) return null;
  const value = record as PriceRecord;
  if (typeof value.TimeUTC !== "string") return null;

  const eur = typeof value.DayAheadPriceEUR === "number"
    ? value.DayAheadPriceEUR
    : Number(value.DayAheadPriceEUR);
  if (!Number.isFinite(eur)) return null;

  const rawTime = value.TimeUTC.endsWith("Z") ? value.TimeUTC : `${value.TimeUTC}Z`;
  const parsed = new Date(rawTime);
  if (Number.isNaN(parsed.getTime())) return null;

  return {
    timeUtc: parsed.toISOString(),
    eurPerMwh: eur,
    approxDkkPerKwh: eur * EUR_DKK_REFERENCE / 1000,
  };
}

async function fetchEnergyPrices(area: string): Promise<EnergyPriceData> {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - 1);
  const end = new Date();
  end.setUTCDate(end.getUTCDate() + 2);

  const url = new URL("https://api.energidataservice.dk/dataset/DayAheadPrices");
  url.searchParams.set("start", isoDate(start));
  url.searchParams.set("end", isoDate(end));
  url.searchParams.set("filter", JSON.stringify({ PriceArea: area }));
  url.searchParams.set("sort", "TimeUTC asc");
  url.searchParams.set("columns", "TimeUTC,DayAheadPriceEUR");

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Nexus/0.1 (+https://nexus.sr-goodjob.workers.dev)",
    },
  });

  if (!response.ok) {
    throw new Error(`energidataservice_http_${response.status}`);
  }

  const body = await response.json() as EnergyDataResponse;
  if (!Array.isArray(body.records)) throw new Error("energidataservice_invalid_response");

  const intervals = body.records
    .map(cleanRecord)
    .filter((point): point is EnergyPricePoint => point !== null);

  if (intervals.length === 0) throw new Error("energidataservice_no_prices");

  return {
    source: "Energi Data Service",
    area,
    resolutionMinutes: 15,
    currencyNote: "DKK/kWh is an indicative conversion using EUR/DKK 7.46038; tariffs and VAT are not included yet.",
    intervals,
  };
}

export async function getEnergyPrices(env: Env & { ENERGY_PRICE_AREA?: string }) {
  const cached = await readSourceCache<EnergyPriceData>(env.DB, CACHE_KEY);
  if (cached && !cached.stale) return cached;

  const area = env.ENERGY_PRICE_AREA === "DK2" ? "DK2" : "DK1";

  try {
    const data = await fetchEnergyPrices(area);
    return await writeSourceCache(env.DB, CACHE_KEY, data, CACHE_TTL_MS);
  } catch (error) {
    const message = error instanceof Error ? error.message : "energy_price_fetch_failed";
    await recordSourceError(env.DB, CACHE_KEY, message);
    if (cached) return { ...cached, stale: true, lastErrorAt: new Date().toISOString(), lastErrorMessage: message };
    throw error;
  }
}
