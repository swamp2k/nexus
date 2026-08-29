import { readSourceCache, recordSourceError, writeSourceCache } from "./cache";
import { getGridTariff, normalizeGridProvider, tariffForTimestamp, type GridProviderKey } from "./energy-tariffs";

const CACHE_TTL_MS = 60 * 60 * 1000;
const EUR_DKK_REFERENCE = 7.46038;
const VAT_RATE = 0.25;

// 2026 Danish household variable charges, excluding VAT.
// Energinet: system tariff 7.2 øre/kWh + distribution-connected net tariff 4.3 øre/kWh.
// State electricity tax: 0.8 øre/kWh in 2026 and 2027.
const ENERGINET_SYSTEM_DKK_PER_KWH = 0.072;
const ENERGINET_NET_DKK_PER_KWH = 0.043;
const ELECTRICITY_TAX_DKK_PER_KWH = 0.008;

type PriceRecord = {
  TimeUTC?: unknown;
  DayAheadPriceEUR?: unknown;
};

type EnergyDataResponse = {
  records?: unknown;
};

type EnergyEnv = Env & {
  ENERGY_PRICE_AREA?: string;
  ENERGY_GRID_PROVIDER?: string;
  ENERGY_SUPPLIER_MARKUP_OERE?: string;
};

type EnergySettingsRow = {
  energyPriceArea: string | null;
  energyGridProvider: string | null;
  energySupplierMarkupOere: number | null;
};

export type EnergyPricePoint = {
  timeUtc: string;
  eurPerMwh: number;
  spotExVatDkkPerKwh: number;
  spotInclVatDkkPerKwh: number;
  gridExVatDkkPerKwh: number | null;
  gridInclVatDkkPerKwh: number | null;
  supplierMarkupExVatDkkPerKwh: number;
  energinetInclVatDkkPerKwh: number;
  electricityTaxInclVatDkkPerKwh: number;
  totalDkkPerKwh: number | null;
  approxDkkPerKwh: number;
};

export type EnergyPriceData = {
  source: "Energi Data Service";
  area: "DK1" | "DK2";
  gridProvider: GridProviderKey | null;
  gridProviderLabel: string | null;
  supplierMarkupOere: number;
  resolutionMinutes: 15;
  totalPriceIncludes: string[];
  totalPriceExcludes: string[];
  currencyNote: string;
  intervals: EnergyPricePoint[];
};

type UserEnergySettings = {
  area: "DK1" | "DK2";
  gridProvider: GridProviderKey | null;
  supplierMarkupOere: number;
};

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function cleanBaseRecord(record: unknown): { timeUtc: string; eurPerMwh: number; spotExVatDkkPerKwh: number } | null {
  if (typeof record !== "object" || record === null) return null;
  const value = record as PriceRecord;
  if (typeof value.TimeUTC !== "string") return null;

  const eur = typeof value.DayAheadPriceEUR === "number" ? value.DayAheadPriceEUR : Number(value.DayAheadPriceEUR);
  if (!Number.isFinite(eur)) return null;

  const rawTime = value.TimeUTC.endsWith("Z") ? value.TimeUTC : `${value.TimeUTC}Z`;
  const parsed = new Date(rawTime);
  if (Number.isNaN(parsed.getTime())) return null;

  return {
    timeUtc: parsed.toISOString(),
    eurPerMwh: eur,
    spotExVatDkkPerKwh: eur * EUR_DKK_REFERENCE / 1000,
  };
}

export function normalizePriceArea(value: string | undefined | null): "DK1" | "DK2" {
  return String(value ?? "DK1").toUpperCase() === "DK2" ? "DK2" : "DK1";
}

function cleanMarkup(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 500) return 0;
  return Math.round(parsed * 1000) / 1000;
}

export async function resolveEnergySettings(env: EnergyEnv, userId: string): Promise<UserEnergySettings> {
  try {
    const row = await env.DB.prepare(
      `SELECT energy_price_area AS energyPriceArea,
              energy_grid_provider AS energyGridProvider,
              energy_supplier_markup_oere AS energySupplierMarkupOere
       FROM user_settings
       WHERE user_id = ?`,
    ).bind(userId).first<EnergySettingsRow>();

    return {
      area: normalizePriceArea(row?.energyPriceArea ?? env.ENERGY_PRICE_AREA),
      gridProvider: normalizeGridProvider(row?.energyGridProvider ?? env.ENERGY_GRID_PROVIDER),
      supplierMarkupOere: cleanMarkup(row?.energySupplierMarkupOere ?? env.ENERGY_SUPPLIER_MARKUP_OERE),
    };
  } catch {
    return {
      area: normalizePriceArea(env.ENERGY_PRICE_AREA),
      gridProvider: normalizeGridProvider(env.ENERGY_GRID_PROVIDER),
      supplierMarkupOere: cleanMarkup(env.ENERGY_SUPPLIER_MARKUP_OERE),
    };
  }
}

async function fetchSpotPrices(area: "DK1" | "DK2") {
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
  if (!response.ok) throw new Error(`energidataservice_http_${response.status}`);

  const body = await response.json() as EnergyDataResponse;
  if (!Array.isArray(body.records)) throw new Error("energidataservice_invalid_response");

  const points = body.records.map(cleanBaseRecord).filter((point): point is NonNullable<ReturnType<typeof cleanBaseRecord>> => point !== null);
  if (points.length === 0) throw new Error("energidataservice_no_prices");
  return points;
}

async function buildEnergyPrices(env: EnergyEnv, settings: UserEnergySettings): Promise<EnergyPriceData> {
  const [spotPoints, gridEnvelope] = await Promise.all([
    fetchSpotPrices(settings.area),
    settings.gridProvider ? getGridTariff(env.DB, settings.gridProvider) : Promise.resolve(null),
  ]);

  const supplierMarkupExVat = settings.supplierMarkupOere / 100;
  const energinetExVat = ENERGINET_SYSTEM_DKK_PER_KWH + ENERGINET_NET_DKK_PER_KWH;
  const grid = gridEnvelope?.data ?? null;

  const intervals: EnergyPricePoint[] = spotPoints.map((point) => {
    const gridExVat = grid ? tariffForTimestamp(grid, point.timeUtc) : null;
    const spotInclVat = point.spotExVatDkkPerKwh * (1 + VAT_RATE);
    const gridInclVat = gridExVat === null ? null : gridExVat * (1 + VAT_RATE);
    const energinetInclVat = energinetExVat * (1 + VAT_RATE);
    const taxInclVat = ELECTRICITY_TAX_DKK_PER_KWH * (1 + VAT_RATE);
    const total = gridExVat === null
      ? null
      : (point.spotExVatDkkPerKwh + gridExVat + supplierMarkupExVat + energinetExVat + ELECTRICITY_TAX_DKK_PER_KWH) * (1 + VAT_RATE);

    return {
      timeUtc: point.timeUtc,
      eurPerMwh: point.eurPerMwh,
      spotExVatDkkPerKwh: point.spotExVatDkkPerKwh,
      spotInclVatDkkPerKwh: spotInclVat,
      gridExVatDkkPerKwh: gridExVat,
      gridInclVatDkkPerKwh: gridInclVat,
      supplierMarkupExVatDkkPerKwh: supplierMarkupExVat,
      energinetInclVatDkkPerKwh: energinetInclVat,
      electricityTaxInclVatDkkPerKwh: taxInclVat,
      totalDkkPerKwh: total,
      // Backwards compatibility for existing clients during deploy.
      approxDkkPerKwh: total ?? spotInclVat,
    };
  });

  return {
    source: "Energi Data Service",
    area: settings.area,
    gridProvider: settings.gridProvider,
    gridProviderLabel: grid?.providerLabel ?? null,
    supplierMarkupOere: settings.supplierMarkupOere,
    resolutionMinutes: 15,
    totalPriceIncludes: ["spotpris", "25% moms", "nettarif", "Energinet system- og nettarif", "elafgift", "elselskabets kWh-tillæg"],
    totalPriceExcludes: ["faste månedlige abonnementer", "eventuelle rabatter eller særordninger"],
    currencyNote: "Samlet pris er den variable marginalpris pr. kWh. Faste abonnementer er ikke fordelt ud på kWh.",
    intervals,
  };
}

export async function getEnergyPrices(env: EnergyEnv, userId: string) {
  const settings = await resolveEnergySettings(env, userId);
  const cacheKey = `energy:total:${settings.area}:${settings.gridProvider ?? "none"}:${settings.supplierMarkupOere}`;
  const cached = await readSourceCache<EnergyPriceData>(env.DB, cacheKey);
  if (cached && !cached.stale) return cached;

  try {
    const data = await buildEnergyPrices(env, settings);
    return await writeSourceCache(env.DB, cacheKey, data, CACHE_TTL_MS);
  } catch (error) {
    const message = error instanceof Error ? error.message : "energy_price_fetch_failed";
    await recordSourceError(env.DB, cacheKey, message);
    if (cached) return { ...cached, stale: true, lastErrorAt: new Date().toISOString(), lastErrorMessage: message };
    throw error;
  }
}
