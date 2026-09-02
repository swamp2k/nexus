import { getAuthenticatedUser } from "../auth/session";
import { createOpaqueToken, hashToken } from "../auth/tokens";
import { getElectricityUsage } from "../sources/eloverblik";
import { getEnergyPrices, resolveEnergySettings } from "../sources/energy-prices";
import { getWeatherForecast, resolveWeatherLocation } from "../sources/weather";

const DISPLAY_COOKIE = "nexus_display";
const DISPLAY_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
const PAIRING_TTL_MS = 10 * 60_000;

type DisplayEnv = Env & {
  ENERGY_PRICE_AREA?: string;
  ENERGY_GRID_PROVIDER?: string;
  ENERGY_SUPPLIER_MARKUP_OERE?: string;
  ELOVERBLIK_REFRESH_TOKEN?: string;
  ELOVERBLIK_METERING_POINT?: string;
  WASTE_CALENDAR_ICS_URL?: string;
  WEATHER_LAT?: string;
  WEATHER_LON?: string;
  WEATHER_LABEL?: string;
};

type DisplayDevice = {
  id: string;
  userId: string;
  name: string;
  createdAt: string;
  lastSeenAt: string;
};

function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === name) return decodeURIComponent(rawValue.join("="));
  }
  return null;
}

function displayCookie(token: string): string {
  return [
    `${DISPLAY_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    `Max-Age=${DISPLAY_MAX_AGE_SECONDS}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ].join("; ");
}

function clearDisplayCookie(): string {
  return [
    `${DISPLAY_COOKIE}=`,
    "Path=/",
    "Max-Age=0",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ].join("; ");
}

function createPairingCode(): string {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return String(bytes[0] % 100_000_000).padStart(8, "0");
}

async function authenticateDisplay(request: Request, env: DisplayEnv): Promise<DisplayDevice | null> {
  const token = readCookie(request, DISPLAY_COOKIE);
  if (!token) return null;
  const tokenHash = await hashToken(token);
  const row = await env.DB.prepare(
    `SELECT id, user_id AS userId, name, created_at AS createdAt, last_seen_at AS lastSeenAt
     FROM display_devices
     WHERE token_hash = ? AND revoked_at IS NULL
     LIMIT 1`,
  ).bind(tokenHash).first<DisplayDevice>();
  if (!row) return null;

  const lastSeen = Date.parse(row.lastSeenAt);
  if (!Number.isFinite(lastSeen) || Date.now() - lastSeen > 5 * 60_000) {
    const now = new Date().toISOString();
    await env.DB.prepare("UPDATE display_devices SET last_seen_at = ? WHERE id = ?")
      .bind(now, row.id).run();
    row.lastSeenAt = now;
  }
  return row;
}

async function readDisplaySettings(env: DisplayEnv, userId: string) {
  const row = await env.DB.prepare(
    `SELECT energy_low_price_dkk AS energyLowPriceDkk,
            energy_high_price_dkk AS energyHighPriceDkk
     FROM user_settings WHERE user_id = ?`,
  ).bind(userId).first<{ energyLowPriceDkk: number | null; energyHighPriceDkk: number | null }>();
  return {
    energyLowPriceDkk: row?.energyLowPriceDkk ?? 1,
    energyHighPriceDkk: row?.energyHighPriceDkk ?? 2,
  };
}

export async function handleDisplayRoute(request: Request, env: DisplayEnv): Promise<Response | null> {
  const url = new URL(request.url);
  const pathname = url.pathname;
  if (!pathname.startsWith("/api/display/")) return null;

  if (pathname === "/api/display/me" && request.method === "GET") {
    const device = await authenticateDisplay(request, env);
    if (!device) return json({ paired: false });
    return json({ paired: true, device: { id: device.id, name: device.name, lastSeenAt: device.lastSeenAt } });
  }

  if (pathname === "/api/display/pair" && request.method === "POST") {
    let body: { code?: unknown; name?: unknown };
    try { body = await request.json(); } catch { return json({ error: "invalid_json" }, { status: 400 }); }
    const code = String(body.code ?? "").replace(/\D/g, "");
    if (code.length !== 8) return json({ error: "invalid_code" }, { status: 400 });
    const codeHash = await hashToken(code);
    const now = new Date().toISOString();
    const pairing = await env.DB.prepare(
      `SELECT id, user_id AS userId, device_name AS deviceName
       FROM display_pairing_codes
       WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?
       LIMIT 1`,
    ).bind(codeHash, now).first<{ id: string; userId: string; deviceName: string }>();
    if (!pairing) return json({ error: "invalid_or_expired_code" }, { status: 401 });

    const token = createOpaqueToken();
    const tokenHash = await hashToken(token);
    const deviceId = crypto.randomUUID();
    const requestedName = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
    const deviceName = requestedName || pairing.deviceName || "Køkken-display";

    await env.DB.batch([
      env.DB.prepare("UPDATE display_pairing_codes SET used_at = ? WHERE id = ? AND used_at IS NULL").bind(now, pairing.id),
      env.DB.prepare(
        `INSERT INTO display_devices (id, user_id, name, token_hash, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(deviceId, pairing.userId, deviceName, tokenHash, now, now),
    ]);

    return json({ paired: true, device: { id: deviceId, name: deviceName } }, {
      headers: { "Set-Cookie": displayCookie(token) },
    });
  }

  if (pathname === "/api/display/unpair" && request.method === "POST") {
    const token = readCookie(request, DISPLAY_COOKIE);
    if (token) {
      const tokenHash = await hashToken(token);
      await env.DB.prepare("UPDATE display_devices SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL")
        .bind(new Date().toISOString(), tokenHash).run();
    }
    return json({ ok: true }, { headers: { "Set-Cookie": clearDisplayCookie() } });
  }

  const user = await getAuthenticatedUser(request, env.DB);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });
  if (user.role === "viewer") return json({ error: "forbidden" }, { status: 403 });

  if (pathname === "/api/display/pairing-code" && request.method === "POST") {
    let body: { name?: unknown } = {};
    try { body = await request.json(); } catch { /* optional body */ }
    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 80) : "Køkken-iPad";
    const code = createPairingCode();
    const codeHash = await hashToken(code);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + PAIRING_TTL_MS).toISOString();
    await env.DB.prepare(
      `INSERT INTO display_pairing_codes (id, user_id, code_hash, device_name, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), user.id, codeHash, name, expiresAt, now.toISOString()).run();
    return json({ code, expiresAt, name });
  }

  if (pathname === "/api/display/devices" && request.method === "GET") {
    const result = await env.DB.prepare(
      `SELECT id, name, created_at AS createdAt, last_seen_at AS lastSeenAt
       FROM display_devices
       WHERE user_id = ? AND revoked_at IS NULL
       ORDER BY created_at DESC`,
    ).bind(user.id).all<{ id: string; name: string; createdAt: string; lastSeenAt: string }>();
    return json({ devices: result.results ?? [] });
  }

  if (pathname.startsWith("/api/display/devices/") && request.method === "DELETE") {
    const id = pathname.slice("/api/display/devices/".length);
    await env.DB.prepare(
      "UPDATE display_devices SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL",
    ).bind(new Date().toISOString(), id, user.id).run();
    return json({ ok: true });
  }

  return json({ error: "not_found" }, { status: 404 });
}

export async function handleDisplayDataAlias(request: Request, env: DisplayEnv): Promise<Response | null> {
  if (request.method !== "GET") return null;
  const pathname = new URL(request.url).pathname;
  const allowed = pathname === "/api/settings" || pathname.startsWith("/api/sources/");
  if (!allowed) return null;

  const device = await authenticateDisplay(request, env);
  if (!device) return null;

  if (pathname === "/api/settings") {
    return json({ settings: await readDisplaySettings(env, device.userId) });
  }

  if (pathname === "/api/sources/weather") {
    const result = await getWeatherForecast(env, device.userId);
    return result ? json(result) : json({ error: "source_not_configured" }, { status: 503 });
  }

  if (pathname === "/api/sources/energy/prices") {
    return json(await getEnergyPrices(env, device.userId));
  }

  if (pathname === "/api/sources/energy/usage") {
    const result = await getElectricityUsage(env);
    return result ? json(result) : json({ error: "source_not_configured" }, { status: 503 });
  }

  if (pathname === "/api/sources/status") {
    const [weatherLocation, energySettings] = await Promise.all([
      resolveWeatherLocation(env, device.userId),
      resolveEnergySettings(env, device.userId),
    ]);
    return json({ sources: {
      weather: { configured: Boolean(weatherLocation), provider: "MET Norway", label: weatherLocation?.label ?? "Hjem" },
      energyPrices: { configured: Boolean(energySettings.gridProvider), area: energySettings.area, gridProvider: energySettings.gridProvider, supplierMarkupOere: energySettings.supplierMarkupOere },
      electricityUsage: { configured: Boolean(env.ELOVERBLIK_REFRESH_TOKEN && env.ELOVERBLIK_METERING_POINT) },
      wasteCalendar: { configured: Boolean(env.WASTE_CALENDAR_ICS_URL), implementation: "calendar_adapter_pending" },
    } });
  }

  return json({ error: "not_found" }, { status: 404 });
}
