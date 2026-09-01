import { getAuthenticatedUser } from "../auth/session";
import { listClassic, normalizeClassicDevices } from "./classic";
import { decryptMelCloudValue, encryptMelCloudValue } from "./credentials";

type MelCloudEnv = Env & { MELCLOUD_CREDENTIALS_KEY?: string; GARMIN_CREDENTIALS_KEY?: string };

type CredentialRow = {
  usernameCiphertext: string;
  usernameIv: string;
  passwordCiphertext: string;
  passwordIv: string;
  updatedAt: string;
};

function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

async function readCredentials(env: MelCloudEnv, userId: string): Promise<{ username: string; password: string; updatedAt: string } | null> {
  const row = await env.DB.prepare(`SELECT username_ciphertext AS usernameCiphertext,username_iv AS usernameIv,password_ciphertext AS passwordCiphertext,password_iv AS passwordIv,updated_at AS updatedAt FROM melcloud_credentials WHERE user_id=?`).bind(userId).first<CredentialRow>();
  if (!row) return null;
  const [username, password] = await Promise.all([
    decryptMelCloudValue(env, row.usernameCiphertext, row.usernameIv),
    decryptMelCloudValue(env, row.passwordCiphertext, row.passwordIv),
  ]);
  return { username, password, updatedAt: row.updatedAt };
}

function cleanUsername(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const username = value.trim();
  return username && username.length <= 254 ? username : null;
}

function cleanPassword(value: unknown): string | null {
  return typeof value === "string" && value && value.length <= 512 ? value : null;
}

async function credentialsRoute(request: Request, env: MelCloudEnv): Promise<Response> {
  const user = await getAuthenticatedUser(request, env.DB);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });
  if (user.role === "viewer") return json({ error: "forbidden" }, { status: 403 });

  if (request.method === "GET") {
    try {
      const credentials = await readCredentials(env, user.id);
      return json(credentials ? { configured: true, username: credentials.username, updatedAt: credentials.updatedAt } : { configured: false, username: null, updatedAt: null });
    } catch {
      return json({ error: "melcloud_credentials_unavailable" }, { status: 503 });
    }
  }

  if (request.method === "PUT") {
    let body: { username?: unknown; password?: unknown };
    try { body = await request.json(); } catch { return json({ error: "invalid_json" }, { status: 400 }); }
    const username = cleanUsername(body.username);
    const password = cleanPassword(body.password);
    if (!username || !password) return json({ error: "invalid_melcloud_credentials" }, { status: 400 });

    try {
      const buildings = await listClassic(username, password);
      const devices = normalizeClassicDevices(buildings);
      const [encryptedUsername, encryptedPassword] = await Promise.all([
        encryptMelCloudValue(env, username),
        encryptMelCloudValue(env, password),
      ]);
      const now = new Date().toISOString();
      await env.DB.prepare(`INSERT INTO melcloud_credentials (user_id,username_ciphertext,username_iv,password_ciphertext,password_iv,created_at,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET username_ciphertext=excluded.username_ciphertext,username_iv=excluded.username_iv,password_ciphertext=excluded.password_ciphertext,password_iv=excluded.password_iv,updated_at=excluded.updated_at`).bind(user.id, encryptedUsername.ciphertext, encryptedUsername.iv, encryptedPassword.ciphertext, encryptedPassword.iv, now, now).run();
      return json({ configured: true, username, updatedAt: now, devices });
    } catch (error) {
      const message = error instanceof Error ? error.message : "melcloud_connect_failed";
      const status = message === "melcloud_invalid_credentials" ? 401 : message === "melcloud_login_throttled" ? 429 : 502;
      return json({ error: message }, { status });
    }
  }

  if (request.method === "DELETE") {
    await env.DB.prepare(`DELETE FROM melcloud_credentials WHERE user_id=?`).bind(user.id).run();
    return new Response(null, { status: 204 });
  }

  return json({ error: "method_not_allowed" }, { status: 405 });
}

async function devicesRoute(request: Request, env: MelCloudEnv): Promise<Response> {
  const user = await getAuthenticatedUser(request, env.DB);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });
  try {
    const credentials = await readCredentials(env, user.id);
    if (!credentials) return json({ error: "melcloud_not_configured" }, { status: 409 });
    const buildings = await listClassic(credentials.username, credentials.password);
    return json({ devices: normalizeClassicDevices(buildings), fetchedAt: new Date().toISOString(), provider: "MELCloud Classic" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "melcloud_fetch_failed";
    return json({ error: message }, { status: message === "melcloud_invalid_credentials" ? 401 : message === "melcloud_login_throttled" ? 429 : 502 });
  }
}

export async function handleMelCloudRoute(request: Request, env: MelCloudEnv): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  if (pathname === "/api/melcloud/credentials") return credentialsRoute(request, env);
  if (pathname === "/api/melcloud/devices" && request.method === "GET") return devicesRoute(request, env);
  return null;
}
