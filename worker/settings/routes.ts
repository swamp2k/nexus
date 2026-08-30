import { getAuthenticatedUser } from "../auth/session";
import { GRID_PROVIDERS, normalizeGridProvider, type GridProviderKey } from "../sources/energy-tariffs";

const DEFAULT_LOW_PRICE_DKK = 1;
const DEFAULT_HIGH_PRICE_DKK = 2;

type SettingsRow = {
  weatherLabel: string | null;
  weatherLat: number | null;
  weatherLon: number | null;
  energyPriceArea: "DK1" | "DK2" | null;
  energyGridProvider: GridProviderKey | null;
  energySupplierMarkupOere: number | null;
  energyLowPriceDkk: number | null;
  energyHighPriceDkk: number | null;
  updatedAt: string | null;
};

type SettingsBody = {
  weatherLabel?: unknown;
  weatherLat?: unknown;
  weatherLon?: unknown;
  energyPriceArea?: unknown;
  energyGridProvider?: unknown;
  energySupplierMarkupOere?: unknown;
  energyLowPriceDkk?: unknown;
  energyHighPriceDkk?: unknown;
};

type SettingsEnv = Env & {
  WEATHER_LABEL?: string;
  WEATHER_LAT?: string;
  WEATHER_LON?: string;
  ENERGY_PRICE_AREA?: string;
  ENERGY_GRID_PROVIDER?: string;
  ENERGY_SUPPLIER_MARKUP_OERE?: string;
};

function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

function cleanLabel(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  const label = value.trim();
  if (!label) return null;
  return label.slice(0, 80);
}

function cleanCoordinate(value: unknown, min: number, max: number): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return null;
  return Math.round(parsed * 100000) / 100000;
}

function cleanPriceArea(value: unknown): "DK1" | "DK2" {
  return String(value ?? "DK1").toUpperCase() === "DK2" ? "DK2" : "DK1";
}

function cleanMarkup(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 500) return 0;
  return Math.round(parsed * 1000) / 1000;
}

function cleanPriceBand(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 20) return fallback;
  return Math.round(parsed * 100) / 100;
}

function fallbackSettings(env: SettingsEnv): SettingsRow {
  return {
    weatherLabel: String(env.WEATHER_LABEL ?? "Hjem").trim() || "Hjem",
    weatherLat: cleanCoordinate(env.WEATHER_LAT, -90, 90),
    weatherLon: cleanCoordinate(env.WEATHER_LON, -180, 180),
    energyPriceArea: cleanPriceArea(env.ENERGY_PRICE_AREA),
    energyGridProvider: normalizeGridProvider(env.ENERGY_GRID_PROVIDER),
    energySupplierMarkupOere: cleanMarkup(env.ENERGY_SUPPLIER_MARKUP_OERE),
    energyLowPriceDkk: DEFAULT_LOW_PRICE_DKK,
    energyHighPriceDkk: DEFAULT_HIGH_PRICE_DKK,
    updatedAt: null,
  };
}

async function readSettings(env: SettingsEnv, userId: string): Promise<SettingsRow> {
  try {
    const row = await env.DB.prepare(
      `SELECT weather_label AS weatherLabel,
              weather_lat AS weatherLat,
              weather_lon AS weatherLon,
              energy_price_area AS energyPriceArea,
              energy_grid_provider AS energyGridProvider,
              energy_supplier_markup_oere AS energySupplierMarkupOere,
              energy_low_price_dkk AS energyLowPriceDkk,
              energy_high_price_dkk AS energyHighPriceDkk,
              updated_at AS updatedAt
       FROM user_settings
       WHERE user_id = ?`,
    ).bind(userId).first<SettingsRow>();

    if (!row) return fallbackSettings(env);
    return {
      ...row,
      energyPriceArea: cleanPriceArea(row.energyPriceArea ?? env.ENERGY_PRICE_AREA),
      energyGridProvider: normalizeGridProvider(row.energyGridProvider ?? env.ENERGY_GRID_PROVIDER),
      energySupplierMarkupOere: cleanMarkup(row.energySupplierMarkupOere ?? env.ENERGY_SUPPLIER_MARKUP_OERE),
      energyLowPriceDkk: cleanPriceBand(row.energyLowPriceDkk, DEFAULT_LOW_PRICE_DKK),
      energyHighPriceDkk: cleanPriceBand(row.energyHighPriceDkk, DEFAULT_HIGH_PRICE_DKK),
    };
  } catch {
    return fallbackSettings(env);
  }
}

export async function handleSettingsRoute(request: Request, env: SettingsEnv): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  if (pathname !== "/api/settings") return null;

  const user = await getAuthenticatedUser(request, env.DB);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });

  if (request.method === "GET") {
    return json({
      settings: await readSettings(env, user.id),
      options: {
        gridProviders: Object.entries(GRID_PROVIDERS).map(([key, provider]) => ({ key, label: provider.label })),
      },
    });
  }

  if (request.method !== "PUT") {
    return json({ error: "method_not_allowed" }, { status: 405 });
  }

  let body: SettingsBody;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, { status: 400 });
  }

  const weatherLabel = cleanLabel(body.weatherLabel);
  const weatherLat = cleanCoordinate(body.weatherLat, -90, 90);
  const weatherLon = cleanCoordinate(body.weatherLon, -180, 180);
  const energyPriceArea = cleanPriceArea(body.energyPriceArea);
  const energyGridProvider = normalizeGridProvider(typeof body.energyGridProvider === "string" ? body.energyGridProvider : null);
  const energySupplierMarkupOere = cleanMarkup(body.energySupplierMarkupOere);
  const energyLowPriceDkk = cleanPriceBand(body.energyLowPriceDkk, DEFAULT_LOW_PRICE_DKK);
  const energyHighPriceDkk = cleanPriceBand(body.energyHighPriceDkk, DEFAULT_HIGH_PRICE_DKK);

  if (weatherLat === null || weatherLon === null) {
    return json({ error: "invalid_weather_location" }, { status: 400 });
  }
  if (!energyGridProvider) {
    return json({ error: "invalid_energy_grid_provider" }, { status: 400 });
  }
  if (energyLowPriceDkk >= energyHighPriceDkk) {
    return json({ error: "invalid_energy_price_bands" }, { status: 400 });
  }

  const updatedAt = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO user_settings (
       user_id, weather_label, weather_lat, weather_lon,
       energy_price_area, energy_grid_provider, energy_supplier_markup_oere,
       energy_low_price_dkk, energy_high_price_dkk, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       weather_label = excluded.weather_label,
       weather_lat = excluded.weather_lat,
       weather_lon = excluded.weather_lon,
       energy_price_area = excluded.energy_price_area,
       energy_grid_provider = excluded.energy_grid_provider,
       energy_supplier_markup_oere = excluded.energy_supplier_markup_oere,
       energy_low_price_dkk = excluded.energy_low_price_dkk,
       energy_high_price_dkk = excluded.energy_high_price_dkk,
       updated_at = excluded.updated_at`,
  ).bind(
    user.id,
    weatherLabel ?? "Hjem",
    weatherLat,
    weatherLon,
    energyPriceArea,
    energyGridProvider,
    energySupplierMarkupOere,
    energyLowPriceDkk,
    energyHighPriceDkk,
    updatedAt,
  ).run();

  return json({
    settings: {
      weatherLabel: weatherLabel ?? "Hjem",
      weatherLat,
      weatherLon,
      energyPriceArea,
      energyGridProvider,
      energySupplierMarkupOere,
      energyLowPriceDkk,
      energyHighPriceDkk,
      updatedAt,
    },
  });
}
