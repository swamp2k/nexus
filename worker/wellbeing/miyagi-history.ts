import { getAuthenticatedUser } from "../auth/session";

type Row = Record<string, unknown>;

function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

export async function handleMiyagiHistoryRoute(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/wellbeing/miyagi/history")) return null;

  const user = await getAuthenticatedUser(request, env.DB);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });

  if (url.pathname === "/api/wellbeing/miyagi/history" && request.method === "GET") {
    const requested = Number(url.searchParams.get("limit") ?? 30);
    const limit = Math.max(1, Math.min(100, Number.isFinite(requested) ? Math.floor(requested) : 30));
    const rows = await env.DB.prepare(
      `SELECT a.id, a.period_days AS periodDays, a.period_start AS periodStart,
              a.period_end AS periodEnd, a.model, a.analysis, a.created_at AS createdAt,
              a.focus, a.response_length AS responseLength, a.tone,
              COUNT(m.id) AS messageCount
       FROM miyagi_analyses a
       LEFT JOIN miyagi_messages m ON m.analysis_id = a.id AND m.user_id = a.user_id
       WHERE a.user_id = ?
       GROUP BY a.id
       ORDER BY a.created_at DESC
       LIMIT ?`,
    ).bind(user.id, limit).all<Row>();

    return json({ analyses: rows.results });
  }

  const match = url.pathname.match(/^\/api\/wellbeing\/miyagi\/history\/([0-9a-f-]+)$/i);
  if (match && request.method === "GET") {
    const analysis = await env.DB.prepare(
      `SELECT id, period_days AS periodDays, period_start AS periodStart,
              period_end AS periodEnd, model, context_hash AS contextHash,
              analysis, created_at AS createdAt, focus,
              response_length AS responseLength, tone
       FROM miyagi_analyses
       WHERE id = ? AND user_id = ?
       LIMIT 1`,
    ).bind(match[1], user.id).first<Row>();
    if (!analysis) return json({ error: "analysis_not_found" }, { status: 404 });

    const messages = await env.DB.prepare(
      `SELECT id, role, body, created_at AS createdAt
       FROM miyagi_messages
       WHERE analysis_id = ? AND user_id = ?
       ORDER BY created_at`,
    ).bind(match[1], user.id).all<Row>();

    return json({ analysis, messages: messages.results });
  }

  return null;
}
