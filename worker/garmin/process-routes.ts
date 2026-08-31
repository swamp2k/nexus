import { getAuthenticatedUser } from "../auth/session";
import { getActivityDetail, listActivities } from "./activity-detail";
import { getGarminOverview, processGarminDbBatch } from "./garmindb-import";
import { getHealthDetail } from "./health-detail";
import { getSleepDetail } from "./sleep-detail";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_RE = /^20\d{2}-\d{2}-\d{2}$/;
const ACTIVITY_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

export async function handleGarminProcessRoute(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const pathname = url.pathname;
  if (pathname !== "/api/garmin/imports/process"
    && pathname !== "/api/garmin/overview"
    && pathname !== "/api/garmin/activities"
    && pathname !== "/api/garmin/activity"
    && pathname !== "/api/garmin/sleep"
    && pathname !== "/api/garmin/health") return null;

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

  if (pathname === "/api/garmin/activities") {
    if (request.method !== "GET") return json({ error: "method_not_allowed" }, { status: 405 });
    const limit = Number(url.searchParams.get("limit") ?? "100");
    return json(await listActivities(env.DB, user.id, Number.isFinite(limit) ? limit : 100));
  }

  if (pathname === "/api/garmin/activity") {
    if (request.method !== "GET") return json({ error: "method_not_allowed" }, { status: 405 });
    const activityId = url.searchParams.get("id") ?? "";
    if (!ACTIVITY_ID_RE.test(activityId)) return json({ error: "invalid_activity_id" }, { status: 400 });
    const detail = await getActivityDetail(env, user.id, activityId);
    if (!detail) return json({ error: "activity_not_found" }, { status: 404 });
    return json(detail);
  }

  if (pathname === "/api/garmin/sleep") {
    if (request.method !== "GET") return json({ error: "method_not_allowed" }, { status: 405 });
    const date = url.searchParams.get("date");
    if (date && !DATE_RE.test(date)) return json({ error: "invalid_date" }, { status: 400 });
    const days = Number(url.searchParams.get("days") ?? "30");
    return json(await getSleepDetail(env, user.id, date, days));
  }

  if (pathname === "/api/garmin/health") {
    if (request.method !== "GET") return json({ error: "method_not_allowed" }, { status: 405 });
    const date = url.searchParams.get("date");
    if (date && !DATE_RE.test(date)) return json({ error: "invalid_date" }, { status: 400 });
    const days = Number(url.searchParams.get("days") ?? "7");
    return json(await getHealthDetail(env.DB, user.id, date, days));
  }

  if (request.method !== "POST") return json({ error: "method_not_allowed" }, { status: 405 });
  const importId = url.searchParams.get("importId") ?? "";
  if (!UUID_RE.test(importId)) return json({ error: "invalid_import_id" }, { status: 400 });

  try {
    return json({ ok: true, ...(await processGarminDbBatch(env, user.id, importId)) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "garmin_processing_failed";
    console.error(JSON.stringify({ event: "garmin_processing_failed", userId: user.id, importId, error: message }));
    return json({ error: "garmin_processing_failed", detail: message }, { status: 422 });
  }
}
