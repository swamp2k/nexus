import { getAuthenticatedUser } from "../auth/session";
import { createOpaqueToken, hashToken } from "../auth/tokens";
import { createForwardEmailProvider } from "../mail/forward-email";

type UserRole = "admin" | "member" | "viewer";
type UserStatus = "active" | "invited" | "disabled";
type UserRow = {
  id: string;
  email: string;
  display_name: string | null;
  role: UserRole;
  status: UserStatus;
  created_at: string;
  updated_at: string;
};

type UserEnv = Env & {
  FORWARD_EMAIL_API_KEY?: string;
  MAIL_FROM?: string;
};

function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

function normalizeName(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return null;
  const name = value.trim();
  return name && name.length <= 100 ? name : null;
}

function isRole(value: unknown): value is UserRole {
  return value === "admin" || value === "member" || value === "viewer";
}

function isStatus(value: unknown): value is UserStatus {
  return value === "active" || value === "invited" || value === "disabled";
}

async function requireAdmin(request: Request, env: Env) {
  const user = await getAuthenticatedUser(request, env.DB);
  if (!user) return { response: json({ error: "unauthorized" }, { status: 401 }) };
  if (user.role !== "admin") return { response: json({ error: "forbidden" }, { status: 403 }) };
  return { user };
}

async function activeAdminCount(env: Env): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND status = 'active'`,
  ).first<{ count: number }>();
  return Number(row?.count ?? 0);
}

async function sendInvite(request: Request, env: UserEnv, user: UserRow): Promise<void> {
  if (!env.FORWARD_EMAIL_API_KEY || !env.MAIL_FROM) throw new Error("mail_provider_not_configured");

  const token = createOpaqueToken();
  const tokenHash = await hashToken(token);
  const now = new Date();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

  await env.DB.batch([
    env.DB.prepare(`DELETE FROM auth_login_tokens WHERE email = ? AND consumed_at IS NULL`).bind(user.email),
    env.DB.prepare(
      `INSERT INTO auth_login_tokens (token_hash, email, created_at, expires_at, consumed_at)
       VALUES (?, ?, ?, ?, NULL)`,
    ).bind(tokenHash, user.email, createdAt, expiresAt),
  ]);

  const loginUrl = new URL("/api/auth/consume", request.url);
  loginUrl.searchParams.set("token", token);

  const mail = createForwardEmailProvider({ apiToken: env.FORWARD_EMAIL_API_KEY, from: env.MAIL_FROM });
  await mail.send({
    to: user.email,
    subject: "Du er inviteret til Nexus",
    text: [
      `Hej${user.display_name ? ` ${user.display_name}` : ""},`,
      "",
      "Du er inviteret til Nexus.",
      "Brug linket herunder for at aktivere din konto og logge ind:",
      "",
      loginUrl.toString(),
      "",
      "Linket udløber om 24 timer og kan kun bruges én gang.",
    ].join("\n"),
    html: `<p>Hej${user.display_name ? ` ${user.display_name}` : ""},</p><p>Du er inviteret til Nexus.</p><p><a href="${loginUrl.toString()}">Aktivér konto og log ind</a></p><p>Linket udløber om 24 timer og kan kun bruges én gang.</p>`,
  });
}

async function listUsers(request: Request, env: Env): Promise<Response> {
  const auth = await requireAdmin(request, env);
  if ("response" in auth) return auth.response;

  const result = await env.DB.prepare(
    `SELECT id, email, display_name, role, status, created_at, updated_at
     FROM users ORDER BY lower(COALESCE(display_name, email)), lower(email)`,
  ).all<UserRow>();

  return json({
    users: result.results.map((user) => ({
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      role: user.role,
      status: user.status,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
    })),
    currentUserId: auth.user.id,
  });
}

async function createUser(request: Request, env: UserEnv): Promise<Response> {
  const auth = await requireAdmin(request, env);
  if ("response" in auth) return auth.response;

  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return json({ error: "invalid_json" }, { status: 400 }); }

  const email = normalizeEmail(body.email);
  const displayName = normalizeName(body.displayName);
  const role = body.role ?? "member";
  if (!email) return json({ error: "invalid_email" }, { status: 400 });
  if (body.displayName != null && body.displayName !== "" && !displayName) return json({ error: "invalid_display_name" }, { status: 400 });
  if (!isRole(role)) return json({ error: "invalid_role" }, { status: 400 });

  const existing = await env.DB.prepare(`SELECT id FROM users WHERE email = ? LIMIT 1`).bind(email).first();
  if (existing) return json({ error: "email_already_exists" }, { status: 409 });

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO users (id, email, display_name, role, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'invited', ?, ?)`,
  ).bind(id, email, displayName, role, now, now).run();

  const user = await env.DB.prepare(
    `SELECT id, email, display_name, role, status, created_at, updated_at FROM users WHERE id = ?`,
  ).bind(id).first<UserRow>();
  if (!user) return json({ error: "create_failed" }, { status: 500 });

  try {
    await sendInvite(request, env, user);
  } catch (error) {
    await env.DB.prepare(`DELETE FROM users WHERE id = ?`).bind(id).run();
    console.error(JSON.stringify({ event: "user_invite_send_failed", userId: id, error: error instanceof Error ? error.message : "unknown_error" }));
    return json({ error: "invite_send_failed" }, { status: 502 });
  }

  return json({ ok: true, id }, { status: 201 });
}

async function updateUser(request: Request, env: Env, id: string): Promise<Response> {
  const auth = await requireAdmin(request, env);
  if ("response" in auth) return auth.response;

  const current = await env.DB.prepare(
    `SELECT id, email, display_name, role, status, created_at, updated_at FROM users WHERE id = ?`,
  ).bind(id).first<UserRow>();
  if (!current) return json({ error: "not_found" }, { status: 404 });

  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return json({ error: "invalid_json" }, { status: 400 }); }

  const email = body.email === undefined ? current.email : normalizeEmail(body.email);
  const displayName = body.displayName === undefined ? current.display_name : normalizeName(body.displayName);
  const role = body.role === undefined ? current.role : body.role;
  const status = body.status === undefined ? current.status : body.status;

  if (!email) return json({ error: "invalid_email" }, { status: 400 });
  if (body.displayName != null && body.displayName !== "" && !displayName) return json({ error: "invalid_display_name" }, { status: 400 });
  if (!isRole(role)) return json({ error: "invalid_role" }, { status: 400 });
  if (!isStatus(status)) return json({ error: "invalid_status" }, { status: 400 });

  const removesActiveAdmin = current.role === "admin" && current.status === "active" && (role !== "admin" || status !== "active");
  if (removesActiveAdmin && await activeAdminCount(env) <= 1) return json({ error: "last_admin" }, { status: 409 });

  if (id === auth.user.id && status !== "active") return json({ error: "cannot_disable_self" }, { status: 409 });

  const now = new Date().toISOString();
  try {
    await env.DB.prepare(
      `UPDATE users SET email = ?, display_name = ?, role = ?, status = ?, updated_at = ? WHERE id = ?`,
    ).bind(email, displayName, role, status, now, id).run();
  } catch (error) {
    if (error instanceof Error && /UNIQUE/i.test(error.message)) return json({ error: "email_already_exists" }, { status: 409 });
    throw error;
  }

  if (status !== "active") {
    await env.DB.prepare(`UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`).bind(now, id).run();
  }

  return json({ ok: true });
}

async function deleteUser(request: Request, env: Env, id: string): Promise<Response> {
  const auth = await requireAdmin(request, env);
  if ("response" in auth) return auth.response;
  if (id === auth.user.id) return json({ error: "cannot_delete_self" }, { status: 409 });

  const current = await env.DB.prepare(`SELECT role, status FROM users WHERE id = ?`).bind(id).first<{ role: UserRole; status: UserStatus }>();
  if (!current) return json({ error: "not_found" }, { status: 404 });
  if (current.role === "admin" && current.status === "active" && await activeAdminCount(env) <= 1) return json({ error: "last_admin" }, { status: 409 });

  await env.DB.prepare(`DELETE FROM users WHERE id = ?`).bind(id).run();
  return json({ ok: true });
}

async function resendInvite(request: Request, env: UserEnv, id: string): Promise<Response> {
  const auth = await requireAdmin(request, env);
  if ("response" in auth) return auth.response;

  const user = await env.DB.prepare(
    `SELECT id, email, display_name, role, status, created_at, updated_at FROM users WHERE id = ?`,
  ).bind(id).first<UserRow>();
  if (!user) return json({ error: "not_found" }, { status: 404 });
  if (user.status !== "invited") return json({ error: "not_invited" }, { status: 409 });

  try { await sendInvite(request, env, user); }
  catch (error) {
    console.error(JSON.stringify({ event: "user_invite_resend_failed", userId: id, error: error instanceof Error ? error.message : "unknown_error" }));
    return json({ error: "invite_send_failed" }, { status: 502 });
  }
  return json({ ok: true });
}

export async function handleUserRoute(request: Request, env: UserEnv): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path === "/api/users") {
    if (request.method === "GET") return listUsers(request, env);
    if (request.method === "POST") return createUser(request, env);
    return json({ error: "method_not_allowed" }, { status: 405 });
  }

  const match = path.match(/^\/api\/users\/([^/]+)(?:\/(resend-invite))?$/);
  if (!match) return null;
  const id = decodeURIComponent(match[1]);
  if (match[2] === "resend-invite") {
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, { status: 405 });
    return resendInvite(request, env, id);
  }
  if (request.method === "PATCH") return updateUser(request, env, id);
  if (request.method === "DELETE") return deleteUser(request, env, id);
  return json({ error: "method_not_allowed" }, { status: 405 });
}
