import { createForwardEmailProvider } from "../mail/forward-email";
import { hashToken, createOpaqueToken } from "./tokens";
import {
  clearSessionCookie,
  createSessionToken,
  getAuthenticatedUser,
  revokeCurrentSession,
  sessionCookie,
} from "./session";

type AuthEnv = Env & {
  FORWARD_EMAIL_API_TOKEN?: string;
  MAIL_FROM?: string;
};

const LOGIN_TOKEN_TTL_MS = 15 * 60 * 1000;
const LOGIN_REQUEST_COOLDOWN_MS = 60 * 1000;

function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (!email || email.length > 254 || !email.includes("@")) return null;
  return email;
}

function genericLoginResponse(): Response {
  return json(
    {
      ok: true,
      message: "If that address can sign in, a login link has been sent.",
    },
    { status: 202 },
  );
}

async function requestLogin(request: Request, env: AuthEnv): Promise<Response> {
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, { status: 405 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "invalid_json" }, { status: 400 });
  }

  const email = normalizeEmail(
    typeof payload === "object" && payload !== null && "email" in payload
      ? (payload as { email?: unknown }).email
      : null,
  );

  if (!email) {
    return json({ error: "invalid_email" }, { status: 400 });
  }

  const user = await env.DB.prepare(
    `SELECT id
     FROM users
     WHERE email = ? AND status = 'active'
     LIMIT 1`,
  )
    .bind(email)
    .first<{ id: string }>();

  // Do not reveal whether the email address belongs to a Nexus account.
  if (!user) return genericLoginResponse();

  const now = new Date();
  const cooldownSince = new Date(
    now.getTime() - LOGIN_REQUEST_COOLDOWN_MS,
  ).toISOString();

  const recentToken = await env.DB.prepare(
    `SELECT 1
     FROM auth_login_tokens
     WHERE email = ?
       AND consumed_at IS NULL
       AND created_at > ?
     LIMIT 1`,
  )
    .bind(email, cooldownSince)
    .first();

  if (recentToken) return genericLoginResponse();

  const token = createOpaqueToken();
  const tokenHash = await hashToken(token);
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + LOGIN_TOKEN_TTL_MS).toISOString();

  await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM auth_login_tokens
       WHERE email = ?
         AND (consumed_at IS NOT NULL OR expires_at <= ?)`,
    ).bind(email, createdAt),
    env.DB.prepare(
      `INSERT INTO auth_login_tokens (
         token_hash, email, created_at, expires_at, consumed_at
       ) VALUES (?, ?, ?, ?, NULL)`,
    ).bind(tokenHash, email, createdAt, expiresAt),
  ]);

  try {
    if (!env.FORWARD_EMAIL_API_TOKEN || !env.MAIL_FROM) {
      throw new Error("mail_provider_not_configured");
    }

    const loginUrl = new URL("/api/auth/consume", request.url);
    loginUrl.searchParams.set("token", token);

    const mail = createForwardEmailProvider({
      apiToken: env.FORWARD_EMAIL_API_TOKEN,
      from: env.MAIL_FROM,
    });

    await mail.send({
      to: email,
      subject: "Log ind på Nexus",
      text: [
        "Brug linket herunder til at logge ind på Nexus:",
        "",
        loginUrl.toString(),
        "",
        "Linket udløber om 15 minutter og kan kun bruges én gang.",
        "Hvis du ikke bad om linket, kan du ignorere denne mail.",
      ].join("\n"),
      html: `<p>Brug knappen herunder til at logge ind på Nexus.</p><p><a href="${loginUrl.toString()}">Log ind på Nexus</a></p><p>Linket udløber om 15 minutter og kan kun bruges én gang.</p><p>Hvis du ikke bad om linket, kan du ignorere denne mail.</p>`,
    });
  } catch (error) {
    // A failed delivery should not leave a valid login token behind.
    await env.DB.prepare(
      `DELETE FROM auth_login_tokens WHERE token_hash = ?`,
    )
      .bind(tokenHash)
      .run();

    console.error(
      JSON.stringify({
        event: "magic_link_send_failed",
        error: error instanceof Error ? error.message : "unknown_error",
      }),
    );
  }

  return genericLoginResponse();
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

  if (pathname === "/api/auth/request") {
    return requestLogin(request, env);
  }

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
