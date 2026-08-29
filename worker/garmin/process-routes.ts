import { getAuthenticatedUser } from "../auth/session";
import { getGarminOverview, processGarminDbBatch } from "./garmindb-import";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

export async function handleGarminProcessRoute(request: Request, env: Env): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  if (pathname !== "/api/garmin/imports/process" && pathname !== "/api/garmin/overview") return null;

  const user = await getAuthenticatedUser(request, env.DB);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });

  if (pathname === "/api/garmin/overview") {
    if (request.method !== "GET") return json({ error: "method_not_allowed" }, { status: 405 });
    try {
      return json(await getGarminOverview(env.DB, user.id));
    } catch (error) {
      const message = error instanceof Error ? error.message : "garmin_overview_failed";
      if (message.includes("no such table")) return json({ daily: null, sleep: null, rhr: null, activities: [], counts: null });
      throw error;
    }
  }

  if (request.method !== "POST") return json({ error: "method_not_allowed" }, { status: 405 });
  const importId = new URL(request.url).searchParams.get("importId") ?? "";
  if (!UUID_RE.test(importId)) return json({ error: "invalid_import_id" }, { status: 400 });

  try {
    return json({ ok: true, ...(await processGarminDbBatch(env, user.id, importId)) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "garmin_processing_failed";
    console.error(JSON.stringify({ event: "garmin_processing_failed", userId: user.id, importId, error: message }));
    return json({ error: "garmin_processing_failed", detail: message }, { status: 422 });
  }
}
