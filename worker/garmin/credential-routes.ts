import { getAuthenticatedUser } from "../auth/session";
import { decryptGarminValue, encryptGarminValue } from "./credentials";

type GarminCredentialsEnv = Env & { GARMIN_CREDENTIALS_KEY?: string };

function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

function cleanUsername(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const username = value.trim();
  if (!username || username.length > 254) return null;
  return username;
}

function cleanPassword(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!value || value.length > 512) return null;
  return value;
}

export async function handleGarminCredentialRoute(request: Request, env: GarminCredentialsEnv): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  if (pathname !== "/api/garmin/credentials") return null;

  const user = await getAuthenticatedUser(request, env.DB);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });
  if (user.role === "viewer") return json({ error: "forbidden" }, { status: 403 });

  if (request.method === "GET") {
    const row = await env.DB.prepare(
      `SELECT username_ciphertext AS usernameCiphertext,
              username_iv AS usernameIv,
              updated_at AS updatedAt
       FROM garmin_credentials WHERE user_id = ?`,
    ).bind(user.id).first<{ usernameCiphertext: string; usernameIv: string; updatedAt: string }>();

    if (!row) return json({ configured: false, username: null, updatedAt: null });

    try {
      const username = await decryptGarminValue(env, row.usernameCiphertext, row.usernameIv);
      return json({ configured: true, username, updatedAt: row.updatedAt });
    } catch {
      return json({ error: "garmin_credentials_unavailable" }, { status: 503 });
    }
  }

  if (request.method === "PUT") {
    let body: { username?: unknown; password?: unknown };
    try { body = await request.json(); }
    catch { return json({ error: "invalid_json" }, { status: 400 }); }

    const username = cleanUsername(body.username);
    const password = cleanPassword(body.password);
    if (!username || !password) return json({ error: "invalid_garmin_credentials" }, { status: 400 });

    try {
      const [encryptedUsername, encryptedPassword] = await Promise.all([
        encryptGarminValue(env, username),
        encryptGarminValue(env, password),
      ]);
      const now = new Date().toISOString();
      await env.DB.prepare(
        `INSERT INTO garmin_credentials (
           user_id, username_ciphertext, username_iv, password_ciphertext, password_iv, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           username_ciphertext = excluded.username_ciphertext,
           username_iv = excluded.username_iv,
           password_ciphertext = excluded.password_ciphertext,
           password_iv = excluded.password_iv,
           updated_at = excluded.updated_at`,
      ).bind(
        user.id,
        encryptedUsername.ciphertext,
        encryptedUsername.iv,
        encryptedPassword.ciphertext,
        encryptedPassword.iv,
        now,
        now,
      ).run();
      return json({ configured: true, username, updatedAt: now });
    } catch (error) {
      console.error(JSON.stringify({
        event: "garmin_credentials_save_failed",
        userId: user.id,
        error: error instanceof Error ? error.message : "unknown_error",
      }));
      return json({ error: "garmin_credentials_unavailable" }, { status: 503 });
    }
  }

  if (request.method === "DELETE") {
    await env.DB.prepare(`DELETE FROM garmin_credentials WHERE user_id = ?`).bind(user.id).run();
    return new Response(null, { status: 204 });
  }

  return json({ error: "method_not_allowed" }, { status: 405 });
}
