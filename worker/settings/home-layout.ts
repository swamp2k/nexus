import { getAuthenticatedUser } from "../auth/session";

type HomeWidgetSize = "small" | "medium" | "wide";
type HomeWidgetLayoutItem = { id: string; size: HomeWidgetSize };
type HomeLayoutBody = { layout?: unknown };

const DEFAULT_LAYOUT: HomeWidgetLayoutItem[] = [
  { id: "weather.current", size: "medium" },
  { id: "energy.price.current", size: "small" },
  { id: "garmin.sleep.lastNight", size: "small" },
  { id: "garmin.steps.today", size: "small" },
  { id: "wellbeing.today", size: "medium" },
];

function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

function normalizeLayout(value: unknown): HomeWidgetLayoutItem[] | null {
  if (!Array.isArray(value) || value.length > 24) return null;
  const result: HomeWidgetLayoutItem[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const candidate = item as { id?: unknown; size?: unknown };
    if (typeof candidate.id !== "string") return null;
    const id = candidate.id.trim();
    if (!id || id.length > 120 || seen.has(id)) return null;
    const size = candidate.size;
    if (size !== "small" && size !== "medium" && size !== "wide") return null;
    seen.add(id);
    result.push({ id, size });
  }

  return result;
}

export async function handleHomeLayoutRoute(request: Request, env: Env): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  if (pathname !== "/api/home-layout") return null;

  const user = await getAuthenticatedUser(request, env.DB);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });

  if (request.method === "GET") {
    try {
      const row = await env.DB.prepare(
        "SELECT layout_json AS layoutJson, updated_at AS updatedAt FROM user_home_layout WHERE user_id = ?",
      ).bind(user.id).first<{ layoutJson: string; updatedAt: string }>();

      if (!row) return json({ layout: DEFAULT_LAYOUT, updatedAt: null, isDefault: true });
      const parsed = normalizeLayout(JSON.parse(row.layoutJson));
      if (!parsed) return json({ layout: DEFAULT_LAYOUT, updatedAt: row.updatedAt, isDefault: true });
      return json({ layout: parsed, updatedAt: row.updatedAt, isDefault: false });
    } catch {
      return json({ layout: DEFAULT_LAYOUT, updatedAt: null, isDefault: true });
    }
  }

  if (request.method !== "PUT") return json({ error: "method_not_allowed" }, { status: 405 });

  let body: HomeLayoutBody;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, { status: 400 });
  }

  const layout = normalizeLayout(body.layout);
  if (!layout) return json({ error: "invalid_layout" }, { status: 400 });

  const updatedAt = new Date().toISOString();
  try {
    await env.DB.prepare(
      `INSERT INTO user_home_layout (user_id, layout_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         layout_json = excluded.layout_json,
         updated_at = excluded.updated_at`,
    ).bind(user.id, JSON.stringify(layout), updatedAt).run();
  } catch {
    return json({ error: "home_layout_storage_unavailable" }, { status: 503 });
  }

  return json({ layout, updatedAt, isDefault: false });
}
