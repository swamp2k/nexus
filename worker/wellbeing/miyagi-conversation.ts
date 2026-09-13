import { getAuthenticatedUser } from "../auth/session";

type MiyagiEnv = Env & {
  ANTHROPIC_API_KEY?: string;
  MIYAGI_MODEL?: string;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  body: string;
  kind: "chat" | "checkin" | "legacy";
  analysisId: string | null;
  journalEntryId: string | null;
  createdAt: string;
};

type AnalysisRow = {
  id: string;
  analysis: string;
};

type AnthropicUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};

type ProviderResult = {
  text: string;
  usage: AnthropicUsage;
};

const MAX_HISTORY_MESSAGES = 10;
const MAX_HISTORY_CHARS = 8_000;
const MAX_ANALYSIS_CHARS = 9_000;
const MAX_SUMMARY_CHARS = 2_500;
const MAX_MESSAGE_CHARS = 4_000;

const CHAT_SYSTEM = `Du er Mr. Miyagi i Nexus og deltager i brugerens ene løbende samtale om velbefindende.

Den seneste gemte analyse er din primære analytiske kontekst. Samtalen kan også indeholde brugerens check-in kommentarer og dine tidligere refleksioner. Brug dem som menneskelig kontekst, men behandl aldrig AI-svar som brugerens egne fakta.

Regler:
- Svar på dansk.
- Skeln fakta, sammenfald og hypotese.
- Opfind aldrig manglende data eller menneskelig kontekst.
- Check-ins med valueType=boolean er Ja/Nej-data (1=Ja, 0=Nej); manglende entry er ikke registreret, ikke Nej.
- Du er ikke læge og må ikke stille diagnoser eller ordinere behandling.
- Praktiske, lavrisiko refleksioner og forslag til ting brugeren kan observere eller afprøve er fine.
- Stil gerne ét relevant opfølgende spørgsmål, hvis brugerens svar kan forklare et fund eller gøre analysen bedre.
- Hvis et spørgsmål kræver nyere strukturerede data end den seneste analyse indeholder, sig det direkte.
- Vær mere interesseret i betydning og sammenhæng end i at gentage rå værdier.`;

const CHECKIN_SYSTEM = `Du er Mr. Miyagi i Nexus. Brugeren har netop gemt en kommentar sammen med sit daglige check-in.

Din opgave er at reagere i den samme løbende Miyagi-samtale som al anden dialog.
- Svar på dansk.
- Vær varm, kort og konkret.
- Reager først på det vigtigste i brugerens egen kommentar.
- Dagens check-in, søvn, puls, stress, Body Battery og aktivitet må bruges, når det faktisk er relevant.
- Den seneste Miyagi-analyse og en kompakt historisk journal-summary må bruges som baggrund, men dagens rå kontekst vejer tungere.
- Tidligere AI-svar er samtalekontekst, ikke bruger-authored ground truth.
- Skeln observation fra hypotese. Opfind aldrig hvorfor noget skete.
- Stil højst ét konkret, åbent opfølgende spørgsmål, hvis det kan gøre kommentaren mere nyttig senere.
- Du er ikke læge og skal ikke diagnosticere eller ordinere behandling.
- Hold svaret typisk under 180 ord.`;

function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

function configured(env: MiyagiEnv): { key: string; model: string } | null {
  const key = env.ANTHROPIC_API_KEY?.trim();
  const model = env.MIYAGI_MODEL?.trim();
  return key && model ? { key, model } : null;
}

function clip(value: string | null | undefined, maxChars: number): string {
  const text = value?.trim() ?? "";
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}

function compactJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

async function recentConversation(db: D1Database, userId: string): Promise<ChatMessage[]> {
  const rows = await db.prepare(
    `SELECT id, role, body, kind, analysisId, journalEntryId, createdAt
     FROM (
       SELECT id, role, body, kind,
              analysis_id AS analysisId,
              journal_entry_id AS journalEntryId,
              created_at AS createdAt
       FROM miyagi_conversation_messages
       WHERE user_id = ? AND kind <> 'legacy'
       ORDER BY created_at DESC
       LIMIT ?
     )
     ORDER BY createdAt`,
  ).bind(userId, MAX_HISTORY_MESSAGES).all<ChatMessage>();

  const selected: ChatMessage[] = [];
  let chars = 0;
  for (let index = rows.results.length - 1; index >= 0; index -= 1) {
    const entry = rows.results[index];
    const body = clip(entry.body, 1_600);
    const extra = body.length;
    if (selected.length && chars + extra > MAX_HISTORY_CHARS) break;
    chars += extra;
    selected.push({ ...entry, body });
  }
  return selected.reverse();
}

async function historicalSummary(db: D1Database, userId: string): Promise<string | null> {
  const row = await db.prepare(
    `SELECT context_summary AS contextSummary
     FROM journal_ai_state
     WHERE user_id = ?
     LIMIT 1`,
  ).bind(userId).first<{ contextSummary: string | null }>();
  return row?.contextSummary ? clip(row.contextSummary, MAX_SUMMARY_CHARS) : null;
}

async function latestAnalysis(db: D1Database, userId: string, requestedId = ""): Promise<AnalysisRow | null> {
  if (requestedId) {
    return db.prepare(
      `SELECT id, analysis
       FROM miyagi_analyses
       WHERE id = ? AND user_id = ?
       LIMIT 1`,
    ).bind(requestedId, userId).first<AnalysisRow>();
  }
  return db.prepare(
    `SELECT id, analysis
     FROM miyagi_analyses
     WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT 1`,
  ).bind(userId).first<AnalysisRow>();
}

async function checkinContext(
  db: D1Database,
  userId: string,
  journal: { id: string; entryDate: string; body: string },
): Promise<string> {
  const [health, sleep, activities, metrics, recent, summary] = await Promise.all([
    db.prepare(
      `SELECT steps, resting_hr AS restingHr, avg_stress AS avgStress,
              body_battery_high AS bodyBatteryHigh, body_battery_low AS bodyBatteryLow,
              body_battery_latest AS bodyBatteryLatest, active_seconds AS activeSeconds
       FROM garmin_daily
       WHERE user_id = ? AND date = ?
       LIMIT 1`,
    ).bind(userId, journal.entryDate).first<Record<string, unknown>>(),
    db.prepare(
      `SELECT sleep_seconds AS sleepSeconds, deep_seconds AS deepSeconds,
              light_seconds AS lightSeconds, rem_seconds AS remSeconds,
              awake_seconds AS awakeSeconds
       FROM garmin_sleep
       WHERE user_id = ? AND date = ?
       LIMIT 1`,
    ).bind(userId, journal.entryDate).first<Record<string, unknown>>(),
    db.prepare(
      `SELECT name, type, duration_seconds AS durationSeconds, distance_m AS distanceM,
              avg_hr AS avgHr, max_hr AS maxHr
       FROM garmin_activities
       WHERE user_id = ?
         AND substr(COALESCE(start_time_local, start_time_gmt), 1, 10) = ?
       ORDER BY COALESCE(start_time_local, start_time_gmt)
       LIMIT 8`,
    ).bind(userId, journal.entryDate).all<Record<string, unknown>>(),
    db.prepare(
      `SELECT m.name, m.emoji, m.direction, m.value_type AS valueType, e.value
       FROM wellbeing_entries e
       JOIN wellbeing_metrics m ON m.id = e.metric_id
       WHERE e.user_id = ? AND e.entry_date = ?
       ORDER BY m.sort_order`,
    ).bind(userId, journal.entryDate).all<Record<string, unknown>>(),
    db.prepare(
      `SELECT entry_date AS entryDate, body
       FROM journal_entries
       WHERE user_id = ? AND id <> ?
         AND entry_date >= date(?, '-14 days')
       ORDER BY created_at DESC
       LIMIT 4`,
    ).bind(userId, journal.id, journal.entryDate).all<{ entryDate: string; body: string }>(),
    historicalSummary(db, userId),
  ]);

  const recentText = recent.results
    .map((row) => `${row.entryDate}: ${clip(row.body, 500)}`)
    .join("\n");

  return [
    `DATO: ${journal.entryDate}`,
    `DAGENS CHECK-IN: ${metrics.results.length ? compactJson(metrics.results) : "(ingen)"}`,
    `DAGENS SUNDHED: ${health ? compactJson(health) : "(ingen)"}`,
    `SØVN: ${sleep ? compactJson(sleep) : "(ingen)"}`,
    `DAGENS AKTIVITETER: ${activities.results.length ? compactJson(activities.results) : "(ingen)"}`,
    `KOMPAKT HISTORISK JOURNAL-SUMMARY:\n${summary ?? "(ingen endnu)"}`,
    `SENESTE JOURNALNOTER:\n${recentText || "(ingen)"}`,
  ].join("\n\n");
}

async function anthropicMessage(
  env: MiyagiEnv,
  system: string,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  maxTokens: number,
  requestKind: "chat" | "checkin",
): Promise<ProviderResult> {
  const config = configured(env);
  if (!config) throw new Error("miyagi_not_configured");

  const promptChars = system.length + messages.reduce((sum, message) => sum + message.content.length, 0);
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model: config.model, max_tokens: maxTokens, system, messages }),
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error(JSON.stringify({ event: "miyagi_provider_error", kind: requestKind, status: response.status, detail: detail.slice(0, 500) }));
    throw new Error(`miyagi_provider_${response.status}`);
  }

  const payload = await response.json() as {
    content?: Array<{ type?: unknown; text?: unknown }>;
    usage?: AnthropicUsage;
  };
  const text = payload.content
    ?.filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => String(block.text))
    .join("\n")
    .trim();
  if (!text) throw new Error("miyagi_empty_response");

  const usage = payload.usage ?? {};
  console.log(JSON.stringify({
    event: "miyagi_usage",
    kind: requestKind,
    model: config.model,
    promptChars,
    inputTokens: usage.input_tokens ?? null,
    outputTokens: usage.output_tokens ?? null,
    cacheCreationInputTokens: usage.cache_creation_input_tokens ?? null,
    cacheReadInputTokens: usage.cache_read_input_tokens ?? null,
  }));

  return { text, usage };
}

async function respondToCheckin(request: Request, env: MiyagiEnv): Promise<Response> {
  const user = await getAuthenticatedUser(request, env.DB);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });
  if (user.role === "viewer") return json({ error: "forbidden" }, { status: 403 });
  if (!configured(env)) return json({ error: "miyagi_not_configured" }, { status: 503 });

  let body: { journalId?: unknown } = {};
  try { body = await request.json(); } catch { return json({ error: "invalid_json" }, { status: 400 }); }
  const journalId = typeof body.journalId === "string" ? body.journalId : "";
  if (!journalId) return json({ error: "invalid_checkin_comment" }, { status: 400 });

  const journal = await env.DB.prepare(
    `SELECT id, entry_date AS entryDate, body, created_at AS createdAt
     FROM journal_entries
     WHERE id = ? AND user_id = ?
     LIMIT 1`,
  ).bind(journalId, user.id).first<{ id: string; entryDate: string; body: string; createdAt: string }>();
  if (!journal) return json({ error: "journal_not_found" }, { status: 404 });

  let userMessage = await env.DB.prepare(
    `SELECT id, role, body, kind, analysis_id AS analysisId,
            journal_entry_id AS journalEntryId, created_at AS createdAt
     FROM miyagi_conversation_messages
     WHERE user_id = ? AND journal_entry_id = ? AND role = 'user' AND source_ref = ?
     LIMIT 1`,
  ).bind(user.id, journal.id, `journal_entries:${journal.id}`).first<ChatMessage>();

  const existingReply = await env.DB.prepare(
    `SELECT id, role, body, kind, analysis_id AS analysisId,
            journal_entry_id AS journalEntryId, created_at AS createdAt
     FROM miyagi_conversation_messages
     WHERE user_id = ? AND journal_entry_id = ? AND role = 'assistant' AND kind = 'checkin'
     ORDER BY created_at
     LIMIT 1`,
  ).bind(user.id, journal.id).first<ChatMessage>();

  if (existingReply) return json({ messages: [userMessage, existingReply].filter(Boolean) });

  if (!userMessage) {
    userMessage = {
      id: crypto.randomUUID(),
      role: "user",
      body: journal.body,
      kind: "checkin",
      analysisId: null,
      journalEntryId: journal.id,
      createdAt: journal.createdAt,
    };
    await env.DB.prepare(
      `INSERT INTO miyagi_conversation_messages
         (id, user_id, role, body, kind, analysis_id, journal_entry_id, source_ref, created_at)
       VALUES (?, ?, 'user', ?, 'checkin', NULL, ?, ?, ?)`,
    ).bind(userMessage.id, user.id, userMessage.body, journal.id, `journal_entries:${journal.id}`, journal.createdAt).run();
  }

  const analysis = await latestAnalysis(env.DB, user.id);
  if (analysis && !userMessage.analysisId) {
    await env.DB.prepare(
      `UPDATE miyagi_conversation_messages SET analysis_id = ? WHERE id = ? AND user_id = ?`,
    ).bind(analysis.id, userMessage.id, user.id).run();
    userMessage = { ...userMessage, analysisId: analysis.id };
  }

  const [history, dayContext] = await Promise.all([
    recentConversation(env.DB, user.id),
    checkinContext(env.DB, user.id, journal),
  ]);
  const historyBeforeCurrent = history.filter((entry) => entry.id !== userMessage?.id);
  const analysisText = analysis ? clip(analysis.analysis, MAX_ANALYSIS_CHARS) : "(ingen analyse endnu)";

  const messages: Array<{ role: "user" | "assistant"; content: string }> = [
    {
      role: "user",
      content: `SENESTE MIYAGI-ANALYSE (kompakt baggrund, intet råt analysedatasæt):\n${analysisText}\n\nKONTEKST FOR DAGENS CHECK-IN:\n${dayContext}`,
    },
    {
      role: "assistant",
      content: "Forstået. Jeg bruger dagens check-in som aktuel kilde og den kompakte analyse som baggrund.",
    },
    ...historyBeforeCurrent.map((entry) => ({ role: entry.role, content: entry.body })),
    { role: "user", content: clip(journal.body, MAX_MESSAGE_CHARS) },
  ];

  const provider = await anthropicMessage(env, CHECKIN_SYSTEM, messages, 650, "checkin");
  const assistantMessage: ChatMessage = {
    id: crypto.randomUUID(),
    role: "assistant",
    body: provider.text,
    kind: "checkin",
    analysisId: analysis?.id ?? null,
    journalEntryId: journal.id,
    createdAt: new Date().toISOString(),
  };

  await env.DB.prepare(
    `INSERT INTO miyagi_conversation_messages
       (id, user_id, role, body, kind, analysis_id, journal_entry_id, source_ref, created_at)
     VALUES (?, ?, 'assistant', ?, 'checkin', ?, ?, NULL, ?)`,
  ).bind(
    assistantMessage.id,
    user.id,
    assistantMessage.body,
    assistantMessage.analysisId,
    journal.id,
    assistantMessage.createdAt,
  ).run();

  return json({ messages: [userMessage, assistantMessage], usage: provider.usage }, { status: 201 });
}

async function chat(request: Request, env: MiyagiEnv): Promise<Response> {
  const user = await getAuthenticatedUser(request, env.DB);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });
  if (user.role === "viewer") return json({ error: "forbidden" }, { status: 403 });
  if (!configured(env)) return json({ error: "miyagi_not_configured" }, { status: 503 });

  let body: { analysisId?: unknown; message?: unknown } = {};
  try { body = await request.json(); } catch { return json({ error: "invalid_json" }, { status: 400 }); }
  const requestedAnalysisId = typeof body.analysisId === "string" ? body.analysisId : "";
  const message = typeof body.message === "string" ? body.message.trim().slice(0, MAX_MESSAGE_CHARS) : "";
  if (!message) return json({ error: "invalid_chat" }, { status: 400 });

  const [analysis, history, summary] = await Promise.all([
    latestAnalysis(env.DB, user.id, requestedAnalysisId),
    recentConversation(env.DB, user.id),
    historicalSummary(env.DB, user.id),
  ]);
  if (requestedAnalysisId && !analysis) return json({ error: "analysis_not_found" }, { status: 404 });

  const analysisContext = analysis
    ? `SENESTE MIYAGI-ANALYSE (råt context_json er bevidst udeladt):\n${clip(analysis.analysis, MAX_ANALYSIS_CHARS)}`
    : "Der er endnu ingen gemt Miyagi-analyse.";
  const longTermContext = `KOMPAKT HISTORISK JOURNAL-SUMMARY:\n${summary ?? "(ingen endnu)"}`;

  const messages: Array<{ role: "user" | "assistant"; content: string }> = [
    { role: "user", content: `${analysisContext}\n\n${longTermContext}` },
    {
      role: "assistant",
      content: analysis
        ? "Forstået. Jeg bruger den kompakte analyse og samtalen som baggrund uden at genindlæse analysedatasættet."
        : "Forstået. Jeg holder mig til samtalen og foregiver ikke at have en analyse, der ikke findes.",
    },
    ...history.map((entry) => ({ role: entry.role, content: entry.body })),
    { role: "user", content: message },
  ];

  const provider = await anthropicMessage(env, CHAT_SYSTEM, messages, 900, "chat");
  const activeAnalysisId = analysis?.id ?? null;
  const userMessage: ChatMessage = {
    id: crypto.randomUUID(),
    role: "user",
    body: message,
    kind: "chat",
    analysisId: activeAnalysisId,
    journalEntryId: null,
    createdAt: new Date().toISOString(),
  };
  const assistantMessage: ChatMessage = {
    id: crypto.randomUUID(),
    role: "assistant",
    body: provider.text,
    kind: "chat",
    analysisId: activeAnalysisId,
    journalEntryId: null,
    createdAt: new Date().toISOString(),
  };

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO miyagi_conversation_messages
         (id, user_id, role, body, kind, analysis_id, journal_entry_id, source_ref, created_at)
       VALUES (?, ?, 'user', ?, 'chat', ?, NULL, NULL, ?)`,
    ).bind(userMessage.id, user.id, userMessage.body, activeAnalysisId, userMessage.createdAt),
    env.DB.prepare(
      `INSERT INTO miyagi_conversation_messages
         (id, user_id, role, body, kind, analysis_id, journal_entry_id, source_ref, created_at)
       VALUES (?, ?, 'assistant', ?, 'chat', ?, NULL, NULL, ?)`,
    ).bind(assistantMessage.id, user.id, assistantMessage.body, activeAnalysisId, assistantMessage.createdAt),
  ]);

  return json({ messages: [userMessage, assistantMessage], usage: provider.usage });
}

export async function handleMiyagiConversationRoute(request: Request, env: Env): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  const miyagiEnv = env as MiyagiEnv;
  if (pathname === "/api/wellbeing/miyagi/checkin" && request.method === "POST") return respondToCheckin(request, miyagiEnv);
  if (pathname === "/api/wellbeing/miyagi/chat" && request.method === "POST") return chat(request, miyagiEnv);
  return null;
}
