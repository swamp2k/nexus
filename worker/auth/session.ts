import { createOpaqueToken, hashToken } from "./tokens";

const SESSION_COOKIE = "nexus_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 90;

export type AuthenticatedUser = {
  id: string;
  email: string;
  displayName: string | null;
  role: "admin" | "member" | "viewer";
};

type SessionRow = {
  id: string;
  email: string;
  display_name: string | null;
  role: AuthenticatedUser["role"];
};

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;

  for (const part of header.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === name) return decodeURIComponent(rawValue.join("="));
  }

  return null;
}

export function sessionCookie(token: string): string {
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ].join("; ");
}

export function clearSessionCookie(): string {
  return [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "Max-Age=0",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ].join("; ");
}

export async function createSessionToken(): Promise<{
  token: string;
  tokenHash: string;
  expiresAt: string;
}> {
  const token = createOpaqueToken();
  const tokenHash = await hashToken(token);
  const expiresAt = new Date(
    Date.now() + SESSION_MAX_AGE_SECONDS * 1000,
  ).toISOString();

  return { token, tokenHash, expiresAt };
}

export async function getAuthenticatedUser(
  request: Request,
  db: D1Database,
): Promise<AuthenticatedUser | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;

  const tokenHash = await hashToken(token);
  const now = new Date().toISOString();

  const row = await db
    .prepare(
      `SELECT u.id, u.email, u.display_name, u.role
       FROM auth_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?
         AND s.revoked_at IS NULL
         AND s.expires_at > ?
         AND u.status = 'active'
       LIMIT 1`,
    )
    .bind(tokenHash, now)
    .first<SessionRow>();

  if (!row) return null;

  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
  };
}

export async function revokeCurrentSession(
  request: Request,
  db: D1Database,
): Promise<void> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return;

  const tokenHash = await hashToken(token);
  const now = new Date().toISOString();

  await db
    .prepare(
      `UPDATE auth_sessions
       SET revoked_at = ?
       WHERE token_hash = ? AND revoked_at IS NULL`,
    )
    .bind(now, tokenHash)
    .run();
}
