import { getAuthenticatedUser } from "../auth/session";

const NAV_ITEMS = [
  "Hjem", "Garmin", "Motion", "Velbefindende", "Vejr", "Strøm", "Kalender", "Varmepumpe",
  "DBA", "Unraid", "PC Watch", "Privateering", "Notifikationer", "Displays",
] as const;

type NavItem = typeof NAV_ITEMS[number];
type NavCategory = { id: string; label: string; tabs: NavItem[] };
type NavEntry = NavItem | NavCategory;

const DEFAULT_CATEGORY: NavCategory = { id: "infrastruktur", label: "Infrastruktur", tabs: ["Unraid", "PC Watch"] };

function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

const isNavItem = (value: unknown): value is NavItem => NAV_ITEMS.includes(value as NavItem);

/** Every page appears exactly once; pages missing from the stored layout are added at the end. */
function cleanLayout(value: unknown): NavEntry[] {
  const used = new Set<NavItem>();
  const ids = new Set<string>();
  const out: NavEntry[] = [];
  const incoming: unknown[] = Array.isArray(value) ? value : [];
  // Older saved menus were a flat list of pages; Unraid and PC Watch now live in a category.
  const legacy = incoming.length > 0 && incoming.every((item) => typeof item === "string");
  let defaultAdded = false;
  for (const item of incoming) {
    if (legacy && (item === "Unraid" || item === "PC Watch")) {
      if (!defaultAdded) { defaultAdded = true; DEFAULT_CATEGORY.tabs.forEach((tab) => used.add(tab)); ids.add(DEFAULT_CATEGORY.id); out.push({ ...DEFAULT_CATEGORY, tabs: [...DEFAULT_CATEGORY.tabs] }); }
    } else if (isNavItem(item)) {
      if (!used.has(item)) { used.add(item); out.push(item); }
    } else if (item && typeof item === "object") {
      const { id, label, tabs } = item as Partial<NavCategory>;
      const cleanTabs = (Array.isArray(tabs) ? tabs : []).filter((tab): tab is NavItem => isNavItem(tab) && !used.has(tab));
      const uniqueTabs = [...new Set(cleanTabs)];
      if (!uniqueTabs.length) continue;
      uniqueTabs.forEach((tab) => used.add(tab));
      const cleanId = typeof id === "string" && /^[a-z0-9-]{1,40}$/.test(id) && !ids.has(id) ? id : `kategori-${ids.size + 1}-${out.length}`;
      ids.add(cleanId);
      out.push({ id: cleanId, label: (typeof label === "string" && label.trim().slice(0, 40)) || "Kategori", tabs: uniqueTabs });
    }
  }
  if (!incoming.length) return cleanLayout(["Hjem", "Garmin", "Motion", "Velbefindende", "Vejr", "Strøm", "Kalender", "Varmepumpe", "DBA", DEFAULT_CATEGORY, "Privateering", "Notifikationer", "Displays"]);
  for (const item of NAV_ITEMS) if (!used.has(item)) out.push(item);
  return out;
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
    return json({ layout: cleanLayout(parsed) });
  }

  if (request.method === "PUT") {
    if (user.role === "viewer") return json({ error: "forbidden" }, { status: 403 });
    let body: { layout?: unknown };
    try { body = await request.json(); } catch { return json({ error: "invalid_json" }, { status: 400 }); }
    const layout = cleanLayout(body.layout);
    const updatedAt = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO user_navigation (user_id, order_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET order_json = excluded.order_json, updated_at = excluded.updated_at`,
    ).bind(user.id, JSON.stringify(layout), updatedAt).run();
    return json({ layout, updatedAt });
  }

  return json({ error: "method_not_allowed" }, { status: 405 });
}
