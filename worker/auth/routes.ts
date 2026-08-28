import { hashToken } from "./tokens";
import {
  clearSessionCookie,
  createSessionToken,
  getAuthenticatedUser,
  revokeCurrentSession,
  sessionCookie,
} from "./session";

function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

async function consumeLoginToken(
  request: Request,
  env: Env,
): Promise<Response> {
  if (request.method !== "GET") {
    return json({ error: "method_not_allowed" }, { status: 405 });
  }

  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (!token) {
    return json({ error: "invalid_login_link" }, { status: 400 });
  }

  const tokenHash = await hashToken(token);
  const now = new Date().toISOString();
  const session = await createSessionToken();

  const [insertSession] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO auth_sessions (
         token_hash,
         user_id,
         created_at,
         expires_at,
         last_seen_at,
         revoked_at
       )
       SELECT ?, u.id, ?, ?, ?, NULL
       FROM auth_login_tokens t
       JOIN users u ON u.email = t.email
       WHERE t.token_hash = ?
         AND t.consumed_at IS NULL
         AND t.expires_at > ?
         AND u.status = 'active'`,
    ).bind(
      session.tokenHash,
      now,
      session.expiresAt,
      now,
      tokenHash,
      now,
    ),
    env.DB.prepare(
      `UPDATE auth_login_tokens
       SET consumed_at = ?
       WHERE token_hash = ?
         AND consumed_at IS NULL
         AND expires_at > ?`,
    ).bind(now, tokenHash, now),
  ]);

  if (!insertSession.meta.changes) {
    return json({ error: "invalid_or_expired_login_link" }, { status: 400 });
  }

  const headers = new Headers({
    Location: "/",
    "Cache-Control": "no-store",
  });
  headers.append("Set-Cookie", sessionCookie(session.token));

  return new Response(null, { status: 303, headers });
}

async function currentUser(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") {
    return json({ error: "method_not_allowed" }, { status: 405 });
  }

  const user = await getAuthenticatedUser(request, env.DB);
  return json({ authenticated: Boolean(user), user });
}

async function logout(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, { status: 405 });
  }

  await revokeCurrentSession(request, env.DB);

  const headers = new Headers({ "Cache-Control": "no-store" });
  headers.append("Set-Cookie", clearSessionCookie());

  return Response.json({ ok: true }, { headers });
}

export async function handleAuthRoute(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;

  if (pathname === "/api/auth/consume") {
    return consumeLoginToken(request, env);
  }

  if (pathname === "/api/auth/me") {
    return currentUser(request, env);
  }

  if (pathname === "/api/auth/logout") {
    return logout(request, env);
  }

  return null;
}
