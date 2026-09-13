import { getAuthenticatedUser } from "../auth/session";

type Row = Record<string, unknown>;

function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

export async function handleWellbeingHistoryRoute(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/wellbeing/history" || request.method !== "GET") return null;

  const user = await getAuthenticatedUser(request, env.DB);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });

  const requested = Number(url.searchParams.get("limit") ?? 90);
  const limit = Math.max(1, Math.min(365, Number.isFinite(requested) ? Math.floor(requested) : 90));

  const dates = await env.DB.prepare(
    `SELECT entry_date AS entryDate
     FROM (
       SELECT entry_date FROM wellbeing_entries WHERE user_id = ?
       UNION
       SELECT entry_date FROM journal_entries WHERE user_id = ?
     )
     ORDER BY entry_date DESC
     LIMIT ?`,
  ).bind(user.id, user.id, limit).all<{ entryDate: string }>();

  if (!dates.results.length) return json({ days: [] });

  const selectedDates = dates.results.map((row) => row.entryDate);
  const oldest = selectedDates[selectedDates.length - 1];
  const newest = selectedDates[0];

  const [entries, journals, conversation] = await Promise.all([
    env.DB.prepare(
      `SELECT e.entry_date AS entryDate, e.value, e.metric_id AS metricId,
              m.name, m.emoji, m.direction, m.value_type AS valueType, m.sort_order AS sortOrder
       FROM wellbeing_entries e
       JOIN wellbeing_metrics m ON m.id = e.metric_id
       WHERE e.user_id = ? AND e.entry_date BETWEEN ? AND ?
       ORDER BY e.entry_date DESC, m.sort_order`,
    ).bind(user.id, oldest, newest).all<Row>(),
    env.DB.prepare(
      `SELECT id, entry_date AS entryDate, body, created_at AS createdAt, updated_at AS updatedAt
       FROM journal_entries
       WHERE user_id = ? AND entry_date BETWEEN ? AND ?
       ORDER BY entry_date DESC, created_at`,
    ).bind(user.id, oldest, newest).all<Row>(),
    env.DB.prepare(
      `SELECT m.id, m.role, m.body, m.kind,
              m.analysis_id AS analysisId, m.journal_entry_id AS journalEntryId,
              m.source_ref AS sourceRef, j.entry_date AS subjectDate,
              m.created_at AS createdAt
       FROM miyagi_conversation_messages m
       JOIN journal_entries j ON j.id = m.journal_entry_id AND j.user_id = m.user_id
       WHERE m.user_id = ? AND m.kind = 'checkin' AND j.entry_date BETWEEN ? AND ?
       ORDER BY j.entry_date DESC, m.created_at, m.id`,
    ).bind(user.id, oldest, newest).all<Row>(),
  ]);

  const dateSet = new Set(selectedDates);
  const metricMap = new Map<string, Row[]>();
  const journalMap = new Map<string, Row[]>();
  const conversationMap = new Map<string, Row[]>();

  for (const row of entries.results) {
    const date = String(row.entryDate ?? "");
    if (!dateSet.has(date)) continue;
    const current = metricMap.get(date) ?? [];
    current.push(row);
    metricMap.set(date, current);
  }

  for (const row of journals.results) {
    const date = String(row.entryDate ?? "");
    if (!dateSet.has(date)) continue;
    const current = journalMap.get(date) ?? [];
    current.push(row);
    journalMap.set(date, current);
  }

  for (const row of conversation.results) {
    const date = String(row.subjectDate ?? "");
    if (!dateSet.has(date)) continue;
    const current = conversationMap.get(date) ?? [];
    current.push(row);
    conversationMap.set(date, current);
  }

  return json({
    days: selectedDates.map((date) => ({
      date,
      metrics: metricMap.get(date) ?? [],
      journals: journalMap.get(date) ?? [],
      conversation: conversationMap.get(date) ?? [],
    })),
  });
}
