import { readSourceCache, recordSourceError, writeSourceCache } from "./cache";

const CACHE_TTL_MS = 15 * 60 * 1000;
const TIME_ZONE = "Europe/Copenhagen";
const SOURCE = "MET Norway" as const;

type MetInstant = {
  details?: {
    air_temperature?: unknown;
    relative_humidity?: unknown;
    wind_speed?: unknown;
    wind_from_direction?: unknown;
    air_pressure_at_sea_level?: unknown;
  };
};

type MetPeriod = {
  summary?: { symbol_code?: unknown };
  details?: {
    precipitation_amount?: unknown;
    probability_of_precipitation?: unknown;
  };
};

type MetTimeseriesItem = {
  time?: unknown;
  data?: {
    instant?: MetInstant;
    next_1_hours?: MetPeriod;
    next_6_hours?: MetPeriod;
    next_12_hours?: MetPeriod;
  };
};

type MetResponse = {
  properties?: {
    timeseries?: unknown;
  };
};

type ParsedPoint = {
  time: string;
  localDate: string;
  localHour: number;
  temperature: number;
  humidity: number | null;
  windSpeed: number | null;
  windDirection: number | null;
  pressure: number | null;
  symbol: string | null;
  precipitationMm: number | null;
  precipitation6hMm: number | null;
  precipitationProbability: number | null;
};

type WeatherLocation = {
  label: string;
  latitude: number;
  longitude: number;
};

export type WeatherForecast = {
  source: typeof SOURCE;
  location: WeatherLocation;
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

type WeatherEnv = Env & {
  WEATHER_LAT?: string;
  WEATHER_LON?: string;
  WEATHER_LABEL?: string;
};

type SettingsWeatherRow = {
  weatherLabel: string | null;
  weatherLat: number | null;
  weatherLon: number | null;
};

function number(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function localParts(date: Date): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    hour: Number(values.hour),
  };
}

function parsePoint(value: unknown): ParsedPoint | null {
  if (typeof value !== "object" || value === null) return null;
  const item = value as MetTimeseriesItem;
  if (typeof item.time !== "string" || !item.data?.instant?.details) return null;

  const timestamp = new Date(item.time);
  if (Number.isNaN(timestamp.getTime())) return null;

  const temperature = number(item.data.instant.details.air_temperature);
  if (temperature === null) return null;

  const preferredPeriod = item.data.next_1_hours ?? item.data.next_6_hours ?? item.data.next_12_hours;
  const local = localParts(timestamp);

  return {
    time: timestamp.toISOString(),
    localDate: local.date,
    localHour: local.hour,
    temperature,
    humidity: number(item.data.instant.details.relative_humidity),
    windSpeed: number(item.data.instant.details.wind_speed),
    windDirection: number(item.data.instant.details.wind_from_direction),
    pressure: number(item.data.instant.details.air_pressure_at_sea_level),
    symbol: typeof preferredPeriod?.summary?.symbol_code === "string" ? preferredPeriod.summary.symbol_code : null,
    precipitationMm: number(item.data.next_1_hours?.details?.precipitation_amount),
    precipitation6hMm: number(item.data.next_6_hours?.details?.precipitation_amount),
    precipitationProbability: number(
      item.data.next_1_hours?.details?.probability_of_precipitation
        ?? item.data.next_6_hours?.details?.probability_of_precipitation
        ?? item.data.next_12_hours?.details?.probability_of_precipitation,
    ),
  };
}

function dailyPrecipitation(dayPoints: ParsedPoint[]): number | null {
  const hourly = dayPoints.filter((point) => point.precipitationMm !== null);
  if (hourly.length >= 12) {
    return hourly.reduce((sum, point) => sum + (point.precipitationMm ?? 0), 0);
  }

  const sixHourly = dayPoints.filter((point) => point.precipitation6hMm !== null && point.localHour % 6 === 0);
  if (sixHourly.length) {
    return sixHourly.reduce((sum, point) => sum + (point.precipitation6hMm ?? 0), 0);
  }

  if (hourly.length) return hourly.reduce((sum, point) => sum + (point.precipitationMm ?? 0), 0);
  return null;
}

function buildDaily(points: ParsedPoint[]): WeatherForecast["daily"] {
  const groups = new Map<string, ParsedPoint[]>();
  for (const point of points) {
    const current = groups.get(point.localDate) ?? [];
    current.push(point);
    groups.set(point.localDate, current);
  }

  return Array.from(groups.entries()).slice(0, 7).map(([date, dayPoints]) => {
    const temperatures = dayPoints.map((point) => point.temperature);
    const probabilities = dayPoints
      .map((point) => point.precipitationProbability)
      .filter((value): value is number => value !== null);
    const daytimePoint = dayPoints.reduce((best, point) => {
      if (!best) return point;
      return Math.abs(point.localHour - 12) < Math.abs(best.localHour - 12) ? point : best;
    }, null as ParsedPoint | null);
    const symbolPoint = dayPoints.reduce((best, point) => {
      if (!point.symbol) return best;
      if (!best) return point;
      return Math.abs(point.localHour - 12) < Math.abs(best.localHour - 12) ? point : best;
    }, null as ParsedPoint | null);

    return {
      date,
      minTemperature: Math.min(...temperatures),
      maxTemperature: Math.max(...temperatures),
      symbol: symbolPoint?.symbol ?? null,
      precipitationMm: dailyPrecipitation(dayPoints),
      maxPrecipitationProbability: probabilities.length > 0 ? Math.max(...probabilities) : null,
      windSpeed: daytimePoint?.windSpeed ?? null,
      windDirection: daytimePoint?.windDirection ?? null,
    };
  });
}

function cacheKey(latitude: number, longitude: number): string {
  return `weather:met:${latitude.toFixed(4)}:${longitude.toFixed(4)}`;
}

function fallbackConfig(env: WeatherEnv): WeatherLocation | null {
  const latitude = number(env.WEATHER_LAT);
  const longitude = number(env.WEATHER_LON);
  if (latitude === null || longitude === null || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return null;
  }
  return {
    latitude,
    longitude,
    label: String(env.WEATHER_LABEL ?? "Hjem").trim() || "Hjem",
  };
}

export async function resolveWeatherLocation(env: WeatherEnv, userId: string): Promise<WeatherLocation | null> {
  try {
    const row = await env.DB.prepare(
      `SELECT weather_label AS weatherLabel,
              weather_lat AS weatherLat,
              weather_lon AS weatherLon
       FROM user_settings
       WHERE user_id = ?`,
    ).bind(userId).first<SettingsWeatherRow>();

    if (
      row?.weatherLat !== null && row?.weatherLat !== undefined
      && row?.weatherLon !== null && row?.weatherLon !== undefined
      && row.weatherLat >= -90 && row.weatherLat <= 90
      && row.weatherLon >= -180 && row.weatherLon <= 180
    ) {
      return {
        label: row.weatherLabel?.trim() || "Hjem",
        latitude: row.weatherLat,
        longitude: row.weatherLon,
      };
    }
  } catch {
    // During first deploy before migration 0004 is applied, keep the configured fallback working.
  }

  return fallbackConfig(env);
}

async function fetchForecast(latitude: number, longitude: number, label: string): Promise<WeatherForecast> {
  const url = new URL("https://api.met.no/weatherapi/locationforecast/2.0/compact");
  url.searchParams.set("lat", latitude.toFixed(4));
  url.searchParams.set("lon", longitude.toFixed(4));

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Nexus/0.1 https://nexus.sr-goodjob.workers.dev",
    },
  });
  if (!response.ok) throw new Error(`met_weather_http_${response.status}`);

  const body = await response.json() as MetResponse;
  if (!Array.isArray(body.properties?.timeseries)) throw new Error("met_weather_invalid_response");

  const points = body.properties.timeseries
    .map(parsePoint)
    .filter((point): point is ParsedPoint => point !== null);
  if (points.length === 0) throw new Error("met_weather_no_forecast");

  const now = Date.now();
  const current = points.find((point) => Date.parse(point.time) >= now - 60 * 60 * 1000) ?? points[0];
  const hourly = points
    .filter((point) => Date.parse(point.time) >= now - 60 * 60 * 1000)
    .slice(0, 24)
    .map((point) => ({
      time: point.time,
      temperature: point.temperature,
      humidity: point.humidity,
      windSpeed: point.windSpeed,
      windDirection: point.windDirection,
      symbol: point.symbol,
      precipitationMm: point.precipitationMm,
      precipitationProbability: point.precipitationProbability,
    }));

  return {
    source: SOURCE,
    location: { label, latitude, longitude },
    current: {
      time: current.time,
      temperature: current.temperature,
      humidity: current.humidity,
      windSpeed: current.windSpeed,
      windDirection: current.windDirection,
      pressure: current.pressure,
      symbol: current.symbol,
      precipitationMm: current.precipitationMm,
    },
    hourly,
    daily: buildDaily(points.filter((point) => Date.parse(point.time) >= now - 60 * 60 * 1000)),
  };
}

function withLocationLabel<T extends { data: WeatherForecast }>(cached: T, location: WeatherLocation): T {
  return {
    ...cached,
    data: {
      ...cached.data,
      location,
    },
  };
}

export async function getWeatherForecast(env: WeatherEnv, userId: string) {
  const weatherConfig = await resolveWeatherLocation(env, userId);
  if (!weatherConfig) return null;

  const key = cacheKey(weatherConfig.latitude, weatherConfig.longitude);
  const cached = await readSourceCache<WeatherForecast>(env.DB, key);
  if (cached && !cached.stale) return withLocationLabel(cached, weatherConfig);

  try {
    const data = await fetchForecast(weatherConfig.latitude, weatherConfig.longitude, weatherConfig.label);
    return await writeSourceCache(env.DB, key, data, CACHE_TTL_MS);
  } catch (error) {
    const message = error instanceof Error ? error.message : "weather_fetch_failed";
    await recordSourceError(env.DB, key, message);
    if (cached) {
      return withLocationLabel({
        ...cached,
        stale: true,
        lastErrorAt: new Date().toISOString(),
        lastErrorMessage: message,
      }, weatherConfig);
    }
    throw error;
  }
}
