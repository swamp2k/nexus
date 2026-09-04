/**
 * UI-side copies of the Worker API response shapes that dashboard widgets and
 * feature pages consume.
 *
 * The Worker modules remain the source of truth:
 * - worker/sources/cache.ts           -> CachedSource
 * - worker/sources/energy-prices.ts   -> EnergyPricePoint / EnergyPriceData
 * - worker/sources/eloverblik.ts      -> UsageDay / ElectricityUsageData
 * - worker/sources/weather.ts         -> WeatherForecast
 * - worker/settings/routes.ts         -> SettingsRow
 *
 * Keep these in sync when a route changes. Widgets should import from here
 * instead of re-declaring partial shapes per file.
 */

import type { RefreshClass } from "./dashboardRefresh";

export type CachedSource<T> = {
  data: T;
  fetchedAt: string;
  expiresAt: string;
  stale: boolean;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
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
  gridProvider: string | null;
  gridProviderLabel: string | null;
  supplierMarkupOere: number;
  resolutionMinutes: 15;
  intervals: EnergyPricePoint[];
  totalPriceIncludes: string[];
  totalPriceExcludes: string[];
};

/** GET /api/sources/energy/prices */
export type EnergyPricesResponse = CachedSource<EnergyPriceData>;

export type UsageDay = { date: string; kwh: number };

/** GET /api/sources/energy/usage */
export type ElectricityUsageResponse = CachedSource<{ source: "Eloverblik"; days: UsageDay[] }>;

export type WeatherForecast = {
  source: "MET Norway";
  location: { label: string; latitude: number; longitude: number };
  current: {
    time: string;
    temperature: number;
    humidity: number | null;
    windSpeed: number | null;
    windDirection: number | null;
    pressure: number | null;
    symbol: string | null;
    precipitationMm: number | null;
  };
  hourly: Array<{
    time: string;
    temperature: number;
    humidity: number | null;
    windSpeed: number | null;
    windDirection: number | null;
    symbol: string | null;
    precipitationMm: number | null;
    precipitationProbability: number | null;
  }>;
  daily: Array<{
    date: string;
    minTemperature: number;
    maxTemperature: number;
    symbol: string | null;
    precipitationMm: number | null;
    maxPrecipitationProbability: number | null;
    windSpeed: number | null;
    windDirection: number | null;
  }>;
};

/** GET /api/sources/weather */
export type WeatherResponse = CachedSource<WeatherForecast>;

export type UserSettings = {
  weatherLabel: string | null;
  weatherLat: number | null;
  weatherLon: number | null;
  energyPriceArea: "DK1" | "DK2" | null;
  energyGridProvider: string | null;
  energySupplierMarkupOere: number | null;
  energyLowPriceDkk: number | null;
  energyHighPriceDkk: number | null;
  energyUsageLowKwh: number | null;
  energyUsageHighKwh: number | null;
  dashboardRefreshSeconds: number | null;
  dashboardRefreshClasses: Record<string, RefreshClass> | null;
  updatedAt: string | null;
};

/**
 * GET /api/settings. Paired displays receive a reduced subset through the
 * display alias, so every field must be treated as optional by consumers.
 */
export type SettingsResponse = { settings: Partial<UserSettings> };

/** Low/high thresholds used by price and usage colour bands. */
export type Bands = { low: number; high: number };

export function bandsFrom(low: unknown, high: unknown, fallback: Bands): Bands {
  const l = Number(low ?? fallback.low);
  const h = Number(high ?? fallback.high);
  return Number.isFinite(l) && Number.isFinite(h) && l >= 0 && h > l ? { low: l, high: h } : fallback;
}

export function bandFor(value: number, bands: Bands): "low" | "medium" | "high" {
  if (value <= bands.low) return "low";
  if (value >= bands.high) return "high";
  return "medium";
}

export const DEFAULT_PRICE_BANDS: Bands = { low: 1, high: 2 };
export const DEFAULT_USAGE_BANDS: Bands = { low: 20, high: 30 };
