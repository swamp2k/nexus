import { getAuthenticatedUser } from "../auth/session";

type Row = Record<string, unknown>;

type TimelineEntry = {
  id: string;
  subjectDate: string;
  createdAt: string;
  author: "user" | "miyagi" | "noteflow-ai" | "system";
  type: "checkin" | "comment" | "checkin_reply" | "chat" | "legacy";
  body?: string;
  values?: Array<{ metricId: string; metricName: string; value: unknown }>;
  journalEntryId?: string | null;
  sourceRef?: string | null;
};

function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

export async function handleWellbeingExportRoute(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/wellbeing/export" || request.method !== "GET") return null;

  const user = await getAuthenticatedUser(request, env.DB);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });

  const subjectId = url.searchParams.get("subjectId") ?? `self:${user.id}`;
  const subject = await env.DB.prepare(
    `SELECT id, name, kind, is_default AS isDefault, allow_multiple_checkins AS allowMultipleCheckins, garmin_enabled AS garminEnabled
     FROM wellbeing_subjects WHERE id = ? AND user_id = ? AND active = 1 LIMIT 1`,
  ).bind(subjectId, user.id).first<Row>();
  if (!subject) return json({ error: "subject_not_found" }, { status: 404 });

  const [metrics, entries, journals, analyses, conversation] = await Promise.all([
    env.DB.prepare(
      `SELECT id, name, emoji, direction, value_type AS valueType, sort_order AS sortOrder,
              active, created_at AS createdAt, updated_at AS updatedAt
       FROM wellbeing_metrics
       WHERE user_id = ? AND subject_id = ?
       ORDER BY sort_order, created_at`,
    ).bind(user.id, subjectId).all<Row>(),
    env.DB.prepare(
      `SELECT e.id, e.checkin_id AS checkinId, e.metric_id AS metricId, m.name AS metricName,
              e.entry_date AS entryDate, e.value,
              c.occurred_at AS occurredAt,
              e.created_at AS createdAt, e.updated_at AS updatedAt
       FROM wellbeing_entries e
       JOIN wellbeing_metrics m ON m.id = e.metric_id AND m.user_id = e.user_id
       JOIN wellbeing_checkins c ON c.id = e.checkin_id AND c.user_id = e.user_id
       WHERE e.user_id = ? AND e.subject_id = ?
       ORDER BY e.entry_date, e.created_at`,
    ).bind(user.id, subjectId).all<Row>(),
    env.DB.prepare(
      `SELECT id, entry_date AS entryDate, body,
              created_at AS createdAt, updated_at AS updatedAt
       FROM journal_entries
       WHERE user_id = ? AND subject_id = ?
       ORDER BY entry_date, created_at`,
    ).bind(user.id, subjectId).all<Row>(),
    env.DB.prepare(
      `SELECT id, period_days AS periodDays, period_start AS periodStart,
              period_end AS periodEnd, model, analysis, focus,
              response_length AS responseLength, tone,
              created_at AS createdAt
       FROM miyagi_analyses
       WHERE user_id = ? AND subject_id = ?
       ORDER BY created_at`,
    ).bind(user.id, subjectId).all<Row>(),
    env.DB.prepare(
      `SELECT m.id, m.role, m.body, m.kind,
              m.analysis_id AS analysisId,
              m.journal_entry_id AS journalEntryId,
              m.source_ref AS sourceRef,
              j.entry_date AS subjectDate,
              m.created_at AS createdAt
       FROM miyagi_conversation_messages m
       LEFT JOIN journal_entries j ON j.id = m.journal_entry_id AND j.user_id = m.user_id
       WHERE m.user_id = ? AND (m.subject_id = ? OR (m.subject_id IS NULL AND ? = 'self:' || m.user_id))
       ORDER BY m.created_at, m.id`,
    ).bind(user.id, subjectId, subjectId).all<Row>(),
  ]);

  const timeline: TimelineEntry[] = [];
  const entriesByCheckin = new Map<string, Row[]>();
  for (const entry of entries.results) {
    const checkinId = stringValue(entry.checkinId);
    const rows = entriesByCheckin.get(checkinId) ?? [];
    rows.push(entry);
    entriesByCheckin.set(checkinId, rows);
  }

  for (const [checkinId, rows] of entriesByCheckin) {
    const subjectDate = stringValue(rows[0]?.entryDate);
    const occurredAt = stringValue(rows[0]?.occurredAt);
    const createdAt = occurredAt || (rows.map((row) => stringValue(row.createdAt)).filter(Boolean).sort()[0] ?? `${subjectDate}T00:00:00.000Z`);
    timeline.push({
      id: `checkin:${checkinId}`,
      subjectDate,
      createdAt,
      author: "user",
      type: "checkin",
      values: rows.map((row) => ({
        metricId: stringValue(row.metricId),
        metricName: stringValue(row.metricName),
        value: row.value,
      })),
    });
  }

  for (const journal of journals.results) {
    timeline.push({
      id: `journal:${stringValue(journal.id)}`,
      subjectDate: stringValue(journal.entryDate),
      createdAt: stringValue(journal.createdAt),
      author: "user",
      type: "comment",
      body: stringValue(journal.body),
      journalEntryId: stringValue(journal.id),
      sourceRef: `journal_entries:${stringValue(journal.id)}`,
    });
  }

  for (const message of conversation.results) {
    const sourceRef = stringValue(message.sourceRef) || null;
    if (sourceRef?.startsWith("journal_entries:")) continue;
    const createdAt = stringValue(message.createdAt);
    const kind = stringValue(message.kind);
    const role = stringValue(message.role);
    const subjectDate = stringValue(message.subjectDate) || createdAt.slice(0, 10);
    const legacy = kind === "legacy";
    timeline.push({
      id: `message:${stringValue(message.id)}`,
      subjectDate,
      createdAt,
      author: legacy && role === "assistant" ? "noteflow-ai" : role === "assistant" ? "miyagi" : "user",
      type: legacy ? "legacy" : kind === "checkin" ? "checkin_reply" : "chat",
      body: stringValue(message.body),
      journalEntryId: stringValue(message.journalEntryId) || null,
      sourceRef,
    });
  }

  timeline.sort((a, b) => {
    const subject = a.subjectDate.localeCompare(b.subjectDate);
    if (subject) return subject;
    const created = a.createdAt.localeCompare(b.createdAt);
    return created || a.id.localeCompare(b.id);
  });

  return json({
    exportedAt: new Date().toISOString(),
    formatVersion: 3,
    subject,
    journalTimeline: timeline,
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
