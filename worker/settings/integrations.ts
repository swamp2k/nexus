import { getAuthenticatedUser } from "../auth/session";

export const INTEGRATION_KEYS = [
  "garmin",
  "wellbeing",
  "weather",
  "electricity",
  "calendar",
  "melcloud",
  "dba",
  "unraid",
  "pcwatch",
  "notifications",
  "displays",
] as const;

export type IntegrationKey = typeof INTEGRATION_KEYS[number];
export type IntegrationMap = Record<IntegrationKey, boolean>;

function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

function defaults(): IntegrationMap {
  return Object.fromEntries(INTEGRATION_KEYS.map((key) => [key, true])) as IntegrationMap;
}

export async function getUserIntegrations(db: D1Database, userId: string): Promise<IntegrationMap> {
  const integrations = defaults();
  const result = await db.prepare(
    `SELECT integration_key, enabled
     FROM user_integrations
     WHERE user_id = ?`,
  ).bind(userId).all<{ integration_key: string; enabled: number }>();

  for (const row of result.results) {
    if ((INTEGRATION_KEYS as readonly string[]).includes(row.integration_key)) {
      integrations[row.integration_key as IntegrationKey] = row.enabled !== 0;
    }
  }
  return integrations;
}

export async function handleIntegrationSettingsRoute(request: Request, env: Env): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  if (pathname !== "/api/integrations") return null;

  const user = await getAuthenticatedUser(request, env.DB);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });

  if (request.method === "GET") {
    return json({ integrations: await getUserIntegrations(env.DB, user.id) });
  }

  if (request.method === "PUT") {
    if (user.role === "viewer") return json({ error: "forbidden" }, { status: 403 });

    let body: { integrations?: Record<string, unknown> };
    try { body = await request.json(); }
    catch { return json({ error: "invalid_json" }, { status: 400 }); }

    if (!body.integrations || typeof body.integrations !== "object" || Array.isArray(body.integrations)) {
      return json({ error: "invalid_integrations" }, { status: 400 });
    }

    const now = new Date().toISOString();
    const statements = INTEGRATION_KEYS.flatMap((key) => {
      const value = body.integrations?.[key];
      if (value === undefined) return [];
      if (typeof value !== "boolean") return [];
      return [env.DB.prepare(
        `INSERT INTO user_integrations (user_id, integration_key, enabled, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, integration_key)
         DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at`,
      ).bind(user.id, key, value ? 1 : 0, now)];
    });

    if (statements.length) await env.DB.batch(statements);
    return json({ integrations: await getUserIntegrations(env.DB, user.id), updatedAt: now });
  }

  return json({ error: "method_not_allowed" }, { status: 405 });
}
