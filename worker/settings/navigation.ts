import { getAuthenticatedUser } from "../auth/session";

const NAV_ITEMS = [
  "Hjem", "Garmin", "Motion", "Velbefindende", "Vejr", "Strøm", "Kalender", "Varmepumpe",
  "DBA", "Unraid", "PC Watch", "Notifikationer", "Displays",
] as const;

type NavItem = typeof NAV_ITEMS[number];

function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

function cleanOrder(value: unknown): NavItem[] {
  const incoming = Array.isArray(value) ? value.filter((item): item is NavItem => NAV_ITEMS.includes(item as NavItem)) : [];
  const unique: NavItem[] = [];
  for (const item of incoming) if (!unique.includes(item)) unique.push(item);
  for (const item of NAV_ITEMS) if (!unique.includes(item)) unique.push(item);
  return unique;
}

export async function handleNavigationRoute(request: Request, env: Env): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  if (pathname !== "/api/navigation") return null;

  const user = await getAuthenticatedUser(request, env.DB);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });

  if (request.method === "GET") {
    const row = await env.DB.prepare("SELECT order_json AS orderJson FROM user_navigation WHERE user_id = ?")
      .bind(user.id).first<{ orderJson: string }>();
    let parsed: unknown = null;
    if (row?.orderJson) {
      try { parsed = JSON.parse(row.orderJson); } catch { parsed = null; }
    }
    return json({ order: cleanOrder(parsed) });
  }

  if (request.method === "PUT") {
    if (user.role === "viewer") return json({ error: "forbidden" }, { status: 403 });
    let body: { order?: unknown };
    try { body = await request.json(); } catch { return json({ error: "invalid_json" }, { status: 400 }); }
    const order = cleanOrder(body.order);
    const updatedAt = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO user_navigation (user_id, order_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET order_json = excluded.order_json, updated_at = excluded.updated_at`,
    ).bind(user.id, JSON.stringify(order), updatedAt).run();
    return json({ order, updatedAt });
  }

  return json({ error: "method_not_allowed" }, { status: 405 });
}
