import { getAuthenticatedUser } from "../auth/session";

type SettingsRow = {
  weatherLabel: string | null;
  weatherLat: number | null;
  weatherLon: number | null;
  updatedAt: string | null;
};

type SettingsBody = {
  weatherLabel?: unknown;
  weatherLat?: unknown;
  weatherLon?: unknown;
};

type SettingsEnv = Env & {
  WEATHER_LABEL?: string;
  WEATHER_LAT?: string;
  WEATHER_LON?: string;
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

function fallbackSettings(env: SettingsEnv): SettingsRow {
  return {
    weatherLabel: String(env.WEATHER_LABEL ?? "Hjem").trim() || "Hjem",
    weatherLat: cleanCoordinate(env.WEATHER_LAT, -90, 90),
    weatherLon: cleanCoordinate(env.WEATHER_LON, -180, 180),
    updatedAt: null,
  };
}

async function readSettings(env: SettingsEnv, userId: string): Promise<SettingsRow> {
  try {
    const row = await env.DB.prepare(
      `SELECT weather_label AS weatherLabel,
              weather_lat AS weatherLat,
              weather_lon AS weatherLon,
              updated_at AS updatedAt
       FROM user_settings
       WHERE user_id = ?`,
    ).bind(userId).first<SettingsRow>();

    return row ?? fallbackSettings(env);
  } catch {
    // Keep the current configured location visible during a deploy before migration 0004 is applied.
    return fallbackSettings(env);
  }
}

export async function handleSettingsRoute(request: Request, env: SettingsEnv): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  if (pathname !== "/api/settings") return null;

  const user = await getAuthenticatedUser(request, env.DB);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });

  if (request.method === "GET") {
    return json({ settings: await readSettings(env, user.id) });
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

  if (weatherLat === null || weatherLon === null) {
    return json({ error: "invalid_weather_location" }, { status: 400 });
  }

  const updatedAt = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO user_settings (user_id, weather_label, weather_lat, weather_lon, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       weather_label = excluded.weather_label,
       weather_lat = excluded.weather_lat,
       weather_lon = excluded.weather_lon,
       updated_at = excluded.updated_at`,
  ).bind(user.id, weatherLabel ?? "Hjem", weatherLat, weatherLon, updatedAt).run();

  return json({
    settings: {
      weatherLabel: weatherLabel ?? "Hjem",
      weatherLat,
      weatherLon,
      updatedAt,
    },
  });
}
