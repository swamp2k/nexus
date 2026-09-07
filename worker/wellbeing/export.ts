import { getAuthenticatedUser } from "../auth/session";

function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

export async function handleWellbeingExportRoute(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/wellbeing/export" || request.method !== "GET") return null;

  const user = await getAuthenticatedUser(request, env.DB);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });

  const [metrics, entries, journals, analyses, conversation] = await Promise.all([
    env.DB.prepare(
      `SELECT id, name, emoji, direction, value_type AS valueType, sort_order AS sortOrder,
              active, created_at AS createdAt, updated_at AS updatedAt
       FROM wellbeing_metrics
       WHERE user_id = ?
       ORDER BY sort_order, created_at`,
    ).bind(user.id).all(),
    env.DB.prepare(
      `SELECT e.id, e.metric_id AS metricId, m.name AS metricName,
              e.entry_date AS entryDate, e.value,
              e.created_at AS createdAt, e.updated_at AS updatedAt
       FROM wellbeing_entries e
       JOIN wellbeing_metrics m ON m.id = e.metric_id AND m.user_id = e.user_id
       WHERE e.user_id = ?
       ORDER BY e.entry_date, e.created_at`,
    ).bind(user.id).all(),
    env.DB.prepare(
      `SELECT id, entry_date AS entryDate, body,
              created_at AS createdAt, updated_at AS updatedAt
       FROM journal_entries
       WHERE user_id = ?
       ORDER BY created_at`,
    ).bind(user.id).all(),
    env.DB.prepare(
      `SELECT id, period_days AS periodDays, period_start AS periodStart,
              period_end AS periodEnd, model, analysis, focus,
              response_length AS responseLength, tone,
              created_at AS createdAt
       FROM miyagi_analyses
       WHERE user_id = ?
       ORDER BY created_at`,
    ).bind(user.id).all(),
    env.DB.prepare(
      `SELECT id, role, body, kind,
              analysis_id AS analysisId,
              journal_entry_id AS journalEntryId,
              source_ref AS sourceRef,
              created_at AS createdAt
       FROM miyagi_conversation_messages
       WHERE user_id = ?
       ORDER BY created_at, id`,
    ).bind(user.id).all(),
  ]);

  return json({
    exportedAt: new Date().toISOString(),
    formatVersion: 1,
    wellbeing: {
      metrics: metrics.results,
      entries: entries.results,
      journals: journals.results,
    },
    miyagi: {
      analyses: analyses.results,
      conversationTimeline: conversation.results,
    },
  });
}
