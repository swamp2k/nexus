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

  const [entries, journals, followups] = await Promise.all([
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
      `SELECT f.id, f.journal_entry_id AS journalEntryId, f.question, f.answer,
              f.model, f.created_at AS createdAt, f.answered_at AS answeredAt
       FROM journal_followups f
       JOIN journal_entries j ON j.id = f.journal_entry_id
       WHERE f.user_id = ? AND j.entry_date BETWEEN ? AND ?
       ORDER BY f.created_at`,
    ).bind(user.id, oldest, newest).all<Row>(),
  ]);

  const dateSet = new Set(selectedDates);
  const metricMap = new Map<string, Row[]>();
  const journalMap = new Map<string, Row[]>();
  const followupMap = new Map<string, Row[]>();

  for (const row of entries.results) {
    const date = String(row.entryDate ?? "");
    if (!dateSet.has(date)) continue;
    const current = metricMap.get(date) ?? [];
    current.push(row);
    metricMap.set(date, current);
  }

  for (const row of followups.results) {
    const journalId = String(row.journalEntryId ?? "");
    const current = followupMap.get(journalId) ?? [];
    current.push(row);
    followupMap.set(journalId, current);
  }

  for (const row of journals.results) {
    const date = String(row.entryDate ?? "");
    if (!dateSet.has(date)) continue;
    const journal = { ...row, followups: followupMap.get(String(row.id ?? "")) ?? [] };
    const current = journalMap.get(date) ?? [];
    current.push(journal);
    journalMap.set(date, current);
  }

  return json({
    days: selectedDates.map((date) => ({
      date,
      metrics: metricMap.get(date) ?? [],
      journals: journalMap.get(date) ?? [],
    })),
  });
}
