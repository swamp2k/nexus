import { getAuthenticatedUser } from "../auth/session";
import { createOpaqueToken, hashToken } from "../auth/tokens";
import { calendarEventsForUser } from "../calendar/routes";
import { melCloudDevicesForUser } from "../melcloud/routes";
import { getElectricityUsage } from "../sources/eloverblik";
import { getEnergyPrices, resolveEnergySettings } from "../sources/energy-prices";
import { getWeatherForecast, resolveWeatherLocation } from "../sources/weather";

const DISPLAY_COOKIE = "nexus_display";
const DISPLAY_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
const PAIRING_TTL_MS = 10 * 60_000;
const DEFAULT_LAYOUT = [
  { id: "energy.price.next24h", size: "wide" },
  { id: "energy.price.current", size: "small" },
  { id: "calendar.waste.next", size: "small" },
  { id: "weather.current", size: "small" },
  { id: "melcloud.atw.current", size: "small" },
];

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
  MELCLOUD_CREDENTIALS_KEY?: string;
  GARMIN_CREDENTIALS_KEY?: string;
};

type DisplayDevice = {
  id: string;
  userId: string;
  name: string;
  dashboardId: string | null;
  createdAt: string;
  lastSeenAt: string;
};

type DashboardRow = {
  id: string;
  userId: string;
  name: string;
  theme: "light" | "dark" | "system";
  layoutJson: string;
  createdAt: string;
  updatedAt: string;
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
  return [`${DISPLAY_COOKIE}=${encodeURIComponent(token)}`, "Path=/", `Max-Age=${DISPLAY_MAX_AGE_SECONDS}`, "HttpOnly", "Secure", "SameSite=Lax"].join("; ");
}

function clearDisplayCookie(): string {
  return [`${DISPLAY_COOKIE}=`, "Path=/", "Max-Age=0", "HttpOnly", "Secure", "SameSite=Lax"].join("; ");
}

function createPairingCode(): string {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return String(bytes[0] % 100_000_000).padStart(8, "0");
}

function cleanTheme(value: unknown): "light" | "dark" | "system" {
  return value === "light" || value === "dark" ? value : "system";
}

function cleanLayout(value: unknown): Array<{ id: string; size: "small" | "medium" | "wide" }> {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const output: Array<{ id: string; size: "small" | "medium" | "wide" }> = [];
  for (const item of value.slice(0, 30)) {
    if (!item || typeof item !== "object") continue;
    const row = item as { id?: unknown; size?: unknown };
    const id = typeof row.id === "string" ? row.id.slice(0, 100) : "";
    if (!id || seen.has(id)) continue;
    const size = row.size === "small" || row.size === "wide" ? row.size : "medium";
    seen.add(id);
    output.push({ id, size });
  }
  return output;
}

function dashboardView(row: DashboardRow) {
  let layout = DEFAULT_LAYOUT;
  try { layout = cleanLayout(JSON.parse(row.layoutJson)) as typeof DEFAULT_LAYOUT; } catch { /* default */ }
  return { id: row.id, name: row.name, theme: row.theme, layout, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

async function readDashboard(env: DisplayEnv, dashboardId: string, userId: string): Promise<DashboardRow | null> {
  return env.DB.prepare(
    `SELECT id,user_id AS userId,name,theme,layout_json AS layoutJson,created_at AS createdAt,updated_at AS updatedAt
     FROM display_dashboards WHERE id=? AND user_id=?`,
  ).bind(dashboardId, userId).first<DashboardRow>();
}

async function authenticateDisplay(request: Request, env: DisplayEnv): Promise<DisplayDevice | null> {
  const token = readCookie(request, DISPLAY_COOKIE);
  if (!token) return null;
  const tokenHash = await hashToken(token);
  const row = await env.DB.prepare(
    `SELECT id,user_id AS userId,name,dashboard_id AS dashboardId,created_at AS createdAt,last_seen_at AS lastSeenAt
     FROM display_devices WHERE token_hash=? AND revoked_at IS NULL LIMIT 1`,
  ).bind(tokenHash).first<DisplayDevice>();
  if (!row) return null;
  const lastSeen = Date.parse(row.lastSeenAt);
  if (!Number.isFinite(lastSeen) || Date.now() - lastSeen > 5 * 60_000) {
    const now = new Date().toISOString();
    await env.DB.prepare("UPDATE display_devices SET last_seen_at=? WHERE id=?").bind(now, row.id).run();
    row.lastSeenAt = now;
  }
  return row;
}

async function readDisplaySettings(env: DisplayEnv, userId: string) {
  const row = await env.DB.prepare(
    `SELECT energy_low_price_dkk AS energyLowPriceDkk,
            energy_high_price_dkk AS energyHighPriceDkk,
            dashboard_refresh_classes AS dashboardRefreshClasses
     FROM user_settings WHERE user_id=?`,
  ).bind(userId).first<{ energyLowPriceDkk: number | null; energyHighPriceDkk: number | null; dashboardRefreshClasses: string | null }>();
  let classes: Record<string, string> = {};
  try { classes = JSON.parse(row?.dashboardRefreshClasses ?? "{}"); } catch { /* defaults */ }
  return { energyLowPriceDkk: row?.energyLowPriceDkk ?? 1, energyHighPriceDkk: row?.energyHighPriceDkk ?? 2, dashboardRefreshClasses: classes };
}

export async function handleDisplayRoute(request: Request, env: DisplayEnv): Promise<Response | null> {
  const url = new URL(request.url);
  const pathname = url.pathname;
  if (!pathname.startsWith("/api/display/")) return null;

  if (pathname === "/api/display/me" && request.method === "GET") {
    const device = await authenticateDisplay(request, env);
    if (!device) return json({ paired: false });
    const dashboard = device.dashboardId ? await readDashboard(env, device.dashboardId, device.userId) : null;
    return json({ paired: true, device: { id: device.id, name: device.name, lastSeenAt: device.lastSeenAt }, dashboard: dashboard ? dashboardView(dashboard) : null });
  }

  if (pathname === "/api/display/pair" && request.method === "POST") {
    let body: { code?: unknown; name?: unknown };
    try { body = await request.json(); } catch { return json({ error: "invalid_json" }, { status: 400 }); }
    const code = String(body.code ?? "").replace(/\D/g, "");
    if (code.length !== 8) return json({ error: "invalid_code" }, { status: 400 });
    const codeHash = await hashToken(code);
    const now = new Date().toISOString();
    const pairing = await env.DB.prepare(
      `SELECT id,user_id AS userId,device_name AS deviceName,dashboard_id AS dashboardId
       FROM display_pairing_codes WHERE code_hash=? AND used_at IS NULL AND expires_at>? LIMIT 1`,
    ).bind(codeHash, now).first<{ id: string; userId: string; deviceName: string; dashboardId: string | null }>();
    if (!pairing || !pairing.dashboardId) return json({ error: "invalid_or_expired_code" }, { status: 401 });
    if (!await readDashboard(env, pairing.dashboardId, pairing.userId)) return json({ error: "dashboard_not_found" }, { status: 404 });

    const token = createOpaqueToken();
    const tokenHash = await hashToken(token);
    const deviceId = crypto.randomUUID();
    const requestedName = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
    const deviceName = requestedName || pairing.deviceName || "Nexus-display";
    try {
      await env.DB.batch([
        env.DB.prepare("UPDATE display_pairing_codes SET used_at=? WHERE id=? AND used_at IS NULL").bind(now, pairing.id),
        env.DB.prepare(
          `INSERT INTO display_devices (id,user_id,pairing_code_id,dashboard_id,name,token_hash,created_at,last_seen_at)
           VALUES (?,?,?,?,?,?,?,?)`,
        ).bind(deviceId, pairing.userId, pairing.id, pairing.dashboardId, deviceName, tokenHash, now, now),
      ]);
    } catch {
      return json({ error: "pairing_code_already_used" }, { status: 409 });
    }
    return json({ paired: true }, { headers: { "Set-Cookie": displayCookie(token) } });
  }

  if (pathname === "/api/display/unpair" && request.method === "POST") {
    const token = readCookie(request, DISPLAY_COOKIE);
    if (token) {
      const tokenHash = await hashToken(token);
      await env.DB.prepare("UPDATE display_devices SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL").bind(new Date().toISOString(), tokenHash).run();
    }
    return json({ ok: true }, { headers: { "Set-Cookie": clearDisplayCookie() } });
  }

  const user = await getAuthenticatedUser(request, env.DB);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });
  if (user.role === "viewer") return json({ error: "forbidden" }, { status: 403 });

  if (pathname === "/api/display/dashboards" && request.method === "GET") {
    const rows = await env.DB.prepare(
      `SELECT id,user_id AS userId,name,theme,layout_json AS layoutJson,created_at AS createdAt,updated_at AS updatedAt
       FROM display_dashboards WHERE user_id=? ORDER BY created_at`,
    ).bind(user.id).all<DashboardRow>();
    return json({ dashboards: (rows.results ?? []).map(dashboardView) });
  }

  if (pathname === "/api/display/dashboards" && request.method === "POST") {
    let body: { name?: unknown; theme?: unknown; layout?: unknown } = {};
    try { body = await request.json(); } catch { return json({ error: "invalid_json" }, { status: 400 }); }
    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 80) : "Nyt display";
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const layout = cleanLayout(body.layout).length ? cleanLayout(body.layout) : DEFAULT_LAYOUT;
    const theme = cleanTheme(body.theme);
    await env.DB.prepare(
      `INSERT INTO display_dashboards (id,user_id,name,theme,layout_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`,
    ).bind(id, user.id, name, theme, JSON.stringify(layout), now, now).run();
    return json({ dashboard: { id, name, theme, layout, createdAt: now, updatedAt: now } }, { status: 201 });
  }

  const dashboardMatch = pathname.match(/^\/api\/display\/dashboards\/([^/]+)$/);
  if (dashboardMatch && request.method === "PUT") {
    const id = decodeURIComponent(dashboardMatch[1]);
    const current = await readDashboard(env, id, user.id);
    if (!current) return json({ error: "not_found" }, { status: 404 });
    let body: { name?: unknown; theme?: unknown; layout?: unknown } = {};
    try { body = await request.json(); } catch { return json({ error: "invalid_json" }, { status: 400 }); }
    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 80) : current.name;
    const theme = body.theme === undefined ? current.theme : cleanTheme(body.theme);
    const layout = body.layout === undefined ? dashboardView(current).layout : cleanLayout(body.layout);
    const now = new Date().toISOString();
    await env.DB.prepare("UPDATE display_dashboards SET name=?,theme=?,layout_json=?,updated_at=? WHERE id=? AND user_id=?")
      .bind(name, theme, JSON.stringify(layout), now, id, user.id).run();
    return json({ dashboard: { id, name, theme, layout, createdAt: current.createdAt, updatedAt: now } });
  }

  if (dashboardMatch && request.method === "DELETE") {
    const id = decodeURIComponent(dashboardMatch[1]);
    await env.DB.prepare("DELETE FROM display_dashboards WHERE id=? AND user_id=?").bind(id, user.id).run();
    return json({ ok: true });
  }

  if (pathname === "/api/display/pairing-code" && request.method === "POST") {
    let body: { name?: unknown; dashboardId?: unknown } = {};
    try { body = await request.json(); } catch { return json({ error: "invalid_json" }, { status: 400 }); }
    const dashboardId = typeof body.dashboardId === "string" ? body.dashboardId : "";
    if (!dashboardId || !await readDashboard(env, dashboardId, user.id)) return json({ error: "invalid_dashboard" }, { status: 400 });
    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 80) : "Nexus-display";
    const code = createPairingCode();
    const codeHash = await hashToken(code);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + PAIRING_TTL_MS).toISOString();
    await env.DB.prepare(
      `INSERT INTO display_pairing_codes (id,user_id,code_hash,device_name,dashboard_id,expires_at,created_at) VALUES (?,?,?,?,?,?,?)`,
    ).bind(crypto.randomUUID(), user.id, codeHash, name, dashboardId, expiresAt, now.toISOString()).run();
    return json({ code, expiresAt, name, dashboardId });
  }

  if (pathname === "/api/display/devices" && request.method === "GET") {
    const result = await env.DB.prepare(
      `SELECT d.id,d.name,d.dashboard_id AS dashboardId,x.name AS dashboardName,d.created_at AS createdAt,d.last_seen_at AS lastSeenAt
       FROM display_devices d LEFT JOIN display_dashboards x ON x.id=d.dashboard_id
       WHERE d.user_id=? AND d.revoked_at IS NULL ORDER BY d.created_at DESC`,
    ).bind(user.id).all<{ id: string; name: string; dashboardId: string | null; dashboardName: string | null; createdAt: string; lastSeenAt: string }>();
    return json({ devices: result.results ?? [] });
  }

  if (pathname.startsWith("/api/display/devices/") && request.method === "DELETE") {
    const id = pathname.slice("/api/display/devices/".length);
    await env.DB.prepare("UPDATE display_devices SET revoked_at=? WHERE id=? AND user_id=? AND revoked_at IS NULL").bind(new Date().toISOString(), id, user.id).run();
    return json({ ok: true });
  }

  return json({ error: "not_found" }, { status: 404 });
}

export async function handleDisplayDataAlias(request: Request, env: DisplayEnv): Promise<Response | null> {
  if (request.method !== "GET") return null;
  const url = new URL(request.url);
  const pathname = url.pathname;
  const allowed = pathname === "/api/settings" || pathname.startsWith("/api/sources/") || pathname === "/api/calendar/events" || pathname === "/api/melcloud/devices";
  if (!allowed) return null;
  const regularUser = await getAuthenticatedUser(request, env.DB);
  if (regularUser) return null;
  const device = await authenticateDisplay(request, env);
  if (!device) return null;

  if (pathname === "/api/settings") return json({ settings: await readDisplaySettings(env, device.userId) });
  if (pathname === "/api/calendar/events") {
    const days = Math.max(1, Math.min(90, Number(url.searchParams.get("days")) || 90));
    return json(await calendarEventsForUser(env, device.userId, days));
  }
  if (pathname === "/api/melcloud/devices") {
    try { return json(await melCloudDevicesForUser(env, device.userId)); }
    catch (error) {
      const message = error instanceof Error ? error.message : "melcloud_fetch_failed";
      const status = message === "melcloud_not_configured" ? 409 : message === "melcloud_login_throttled" ? 429 : 502;
      return json({ error: message }, { status });
    }
  }
  if (pathname === "/api/sources/weather") {
    const result = await getWeatherForecast(env, device.userId);
    return result ? json(result) : json({ error: "source_not_configured" }, { status: 503 });
  }
  if (pathname === "/api/sources/energy/prices") return json(await getEnergyPrices(env, device.userId));
  if (pathname === "/api/sources/energy/usage") {
    const result = await getElectricityUsage(env);
    return result ? json(result) : json({ error: "source_not_configured" }, { status: 503 });
  }
  if (pathname === "/api/sources/status") {
    const [weatherLocation, energySettings] = await Promise.all([resolveWeatherLocation(env, device.userId), resolveEnergySettings(env, device.userId)]);
    return json({ sources: {
      weather: { configured: Boolean(weatherLocation), provider: "MET Norway", label: weatherLocation?.label ?? "Hjem" },
      energyPrices: { configured: Boolean(energySettings.gridProvider), area: energySettings.area, gridProvider: energySettings.gridProvider, supplierMarkupOere: energySettings.supplierMarkupOere },
      electricityUsage: { configured: Boolean(env.ELOVERBLIK_REFRESH_TOKEN && env.ELOVERBLIK_METERING_POINT) },
      wasteCalendar: { configured: true, implementation: "ical" },
    } });
  }
  return json({ error: "not_found" }, { status: 404 });
}
