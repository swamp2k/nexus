import { getAuthenticatedUser } from "../auth/session";

type AiEnv = Env & {
  ANTHROPIC_API_KEY?: string;
  MIYAGI_MODEL?: string;
};

type Row = Record<string, unknown>;
type FollowupRow = {
  id: string;
  question: string;
  answer: string | null;
  model: string | null;
  createdAt: string;
  answeredAt: string | null;
};

function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

function configured(env: AiEnv): { key: string; model: string } | null {
  const key = env.ANTHROPIC_API_KEY?.trim();
  const model = env.MIYAGI_MODEL?.trim();
  return key && model ? { key, model } : null;
}

async function callAnthropic(
  env: AiEnv,
  system: string,
  content: string,
  maxTokens = 500,
): Promise<string> {
  const config = configured(env);
  if (!config) throw new Error("journal_ai_not_configured");
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content }],
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    console.error(JSON.stringify({ event: "journal_ai_provider_error", status: response.status, detail: detail.slice(0, 400) }));
    throw new Error(`journal_ai_provider_${response.status}`);
  }
  const payload = await response.json() as { content?: Array<{ type?: unknown; text?: unknown }> };
  const text = payload.content
    ?.filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => String(block.text))
    .join("\n")
    .trim();
  if (!text) throw new Error("journal_ai_empty_response");
  return text;
}

const SUMMARY_SYSTEM = `Du vedligeholder en kompakt baggrundsopsummering af en privat journal.
Svar på dansk. Bevar kun information der kan være nyttig som kontekst for fremtidige journalnoter: tilbagevendende temaer, ændringer, belastninger, positive perioder, rutiner og væsentlige hændelser. Vær tæt og faktuel. Undgå lange citater, spekulation og medicinske konklusioner. Maks ca. 350 ord.`;

const JOURNAL_SYSTEM = `Du er Nexus' journal-assistent. Brugeren har lige skrevet et privat journalnotat.

Din opgave er at hjælpe brugeren med at reflektere og eventuelt uddybe det, de selv har skrevet. Du får også et meget begrænset udsnit af Nexus-data som kontekst.

Regler:
- Svar på dansk.
- Vær varm, kort og konkret.
- Start med 1-3 sætninger der reagerer på det vigtigste i brugerens tekst.
- Hvis dagens check-in, søvn, puls, stress, Body Battery, aktivitet eller nyere journalhistorik giver relevant kontekst, må du nævne sammenhængen — men kun når den faktisk er relevant.
- Brug ikke rå tal bare fordi de findes. Betydning før data.
- Skeln observation fra hypotese. Opfind aldrig hvorfor noget skete.
- Stil til sidst ét konkret, åbent opfølgende spørgsmål som kan gøre notatet mere nyttigt senere.
- Du er ikke læge og skal ikke diagnosticere eller ordinere behandling.
- Hold svaret typisk under 180 ord.`;

const FOLLOWUP_SYSTEM = `Du er Nexus' journal-assistent og fortsætter en kort refleksion om ét bestemt journalnotat.
Svar på dansk. Brug journalnotatet, dagens Nexus-kontekst og den korte samtale hidtil. Reager på brugerens svar og stil højst ét nyt spørgsmål, hvis der stadig er noget konkret og nyttigt at uddybe. Undgå at trække samtalen ud bare for at fortsætte. Maks ca. 140 ord.`;

export async function refreshHistoricalSummary(env: AiEnv, userId: string): Promise<string | null> {
  const state = await env.DB.prepare(
    `SELECT context_summary AS contextSummary, summary_covers_until AS coversUntil,
            summary_updated_at AS updatedAt
     FROM journal_ai_state WHERE user_id = ?`,
  ).bind(userId).first<{ contextSummary: string | null; coversUntil: string | null; updatedAt: string | null }>();

  if (!configured(env)) return state?.contextSummary ?? null;

  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const maxInputCharacters = 60_000;
  const maxPasses = 3;
  let contextSummary = state?.contextSummary ?? null;
  let coversUntil = state?.coversUntil ?? null;

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const rows = await env.DB.prepare(
      `SELECT body, entryDate, createdAt FROM (
         SELECT body, entry_date AS entryDate, created_at AS createdAt
         FROM journal_entries
         WHERE user_id = ? AND entry_date < ?
           AND (? IS NULL OR created_at > ?)
         UNION ALL
         SELECT body, substr(created_at, 1, 10) AS entryDate, created_at AS createdAt
         FROM journal_legacy_messages
         WHERE user_id = ? AND role = 'user' AND substr(created_at, 1, 10) < ?
           AND (? IS NULL OR created_at > ?)
       )
       ORDER BY createdAt
       LIMIT 250`,
    ).bind(
      userId, cutoff, coversUntil, coversUntil,
      userId, cutoff, coversUntil, coversUntil,
    ).all<{ body: string; entryDate: string; createdAt: string }>();

    if (!rows.results.length) break;

    const additions: string[] = [];
    let inputCharacters = 0;
    let nextCoversUntil = coversUntil;

    for (const row of rows.results) {
      const addition = `${row.entryDate}: ${row.body.slice(0, 900)}`;
      const extra = addition.length + (additions.length ? 1 : 0);
      if (
        additions.length
        && inputCharacters + extra > maxInputCharacters
        && row.createdAt !== nextCoversUntil
      ) break;
      additions.push(addition);
      inputCharacters += extra;
      nextCoversUntil = row.createdAt;
    }

    if (!additions.length || !nextCoversUntil) break;

    const previous = contextSummary ? `EKSISTERENDE SUMMARY:\n${contextSummary}\n\n` : "";
    contextSummary = await callAnthropic(
      env,
      SUMMARY_SYSTEM,
      `${previous}NYE ÆLDRE BRUGERSKREVNE JOURNALDATA:\n${additions.join("\n")}\n\nSkriv en ny samlet kompakt summary. Legacy AI-svar er bevidst udeladt; materialet ovenfor er brugerens egne journalnoter og egne beskeder.`,
      650,
    );

    coversUntil = nextCoversUntil;
    const timestamp = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO journal_ai_state (user_id, context_summary, summary_covers_until, summary_updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         context_summary = excluded.context_summary,
         summary_covers_until = excluded.summary_covers_until,
         summary_updated_at = excluded.summary_updated_at`,
    ).bind(userId, contextSummary, coversUntil, timestamp).run();

    if (additions.length === rows.results.length && rows.results.length < 250) break;
  }

  return contextSummary;
}

async function buildJournalContext(env: AiEnv, userId: string, journal: { id: string; entryDate: string; body: string }): Promise<string> {
  const [health, sleep, activities, metrics, recent, historicalSummary, followups] = await Promise.all([
    env.DB.prepare(
      `SELECT steps, resting_hr AS restingHr, avg_stress AS avgStress,
              body_battery_high AS bodyBatteryHigh, body_battery_low AS bodyBatteryLow,
              body_battery_latest AS bodyBatteryLatest, active_seconds AS activeSeconds
       FROM garmin_daily WHERE user_id = ? AND date = ? LIMIT 1`,
    ).bind(userId, journal.entryDate).first<Row>(),
    env.DB.prepare(
      `SELECT sleep_seconds AS sleepSeconds, deep_seconds AS deepSeconds,
              light_seconds AS lightSeconds, rem_seconds AS remSeconds,
              awake_seconds AS awakeSeconds
       FROM garmin_sleep WHERE user_id = ? AND date = ? LIMIT 1`,
    ).bind(userId, journal.entryDate).first<Row>(),
    env.DB.prepare(
      `SELECT name, type, duration_seconds AS durationSeconds, distance_m AS distanceM,
              avg_hr AS avgHr, max_hr AS maxHr
       FROM garmin_activities
       WHERE user_id = ? AND substr(COALESCE(start_time_local, start_time_gmt), 1, 10) = ?
       ORDER BY COALESCE(start_time_local, start_time_gmt)`,
    ).bind(userId, journal.entryDate).all<Row>(),
    env.DB.prepare(
      `SELECT m.name, m.emoji, m.direction, e.value
       FROM wellbeing_entries e
       JOIN wellbeing_metrics m ON m.id = e.metric_id
       WHERE e.user_id = ? AND e.entry_date = ?
       ORDER BY m.sort_order`,
    ).bind(userId, journal.entryDate).all<Row>(),
    env.DB.prepare(
      `SELECT entry_date AS entryDate, body
       FROM journal_entries
       WHERE user_id = ? AND id <> ?
         AND entry_date >= date(?, '-30 days')
       ORDER BY created_at DESC
       LIMIT 12`,
    ).bind(userId, journal.id, journal.entryDate).all<{ entryDate: string; body: string }>(),
    refreshHistoricalSummary(env, userId),
    env.DB.prepare(
      `SELECT id, question, answer, model, created_at AS createdAt, answered_at AS answeredAt
       FROM journal_followups
       WHERE journal_entry_id = ? AND user_id = ?
       ORDER BY created_at
       LIMIT 6`,
    ).bind(journal.id, userId).all<FollowupRow>(),
  ]);

  const recentText = recent.results
    .map((row) => `${row.entryDate}: ${row.body.slice(0, 800)}`)
    .join("\n");
  const conversation = followups.results
    .map((row) => `AI: ${row.question}\nBruger: ${row.answer ?? "(ikke besvaret)"}`)
    .join("\n");

  return [
    `DATO: ${journal.entryDate}`,
    `NYT JOURNALNOTAT:\n${journal.body.slice(0, 4000)}`,
    `DAGENS CHECK-IN:\n${metrics.results.length ? JSON.stringify(metrics.results) : "(ingen)"}`,
    `DAGENS SUNDHED:\n${health ? JSON.stringify(health) : "(ingen)"}`,
    `SØVN:\n${sleep ? JSON.stringify(sleep) : "(ingen)"}`,
    `DAGENS AKTIVITETER:\n${activities.results.length ? JSON.stringify(activities.results) : "(ingen)"}`,
    `KOMPAKT ÆLDRE JOURNALHISTORIK:\n${historicalSummary ?? "(ingen endnu)"}`,
    `SENESTE JOURNALNOTER:\n${recentText || "(ingen)"}`,
    conversation ? `OPFØLGNING HIDTIL:\n${conversation}` : "",
  ].filter(Boolean).join("\n\n");
}

async function journalForUser(env: AiEnv, userId: string, journalId: string) {
  return env.DB.prepare(
    `SELECT id, entry_date AS entryDate, body FROM journal_entries
     WHERE id = ? AND user_id = ? LIMIT 1`,
  ).bind(journalId, userId).first<{ id: string; entryDate: string; body: string }>();
}

async function generate(request: Request, env: AiEnv): Promise<Response> {
  const user = await getAuthenticatedUser(request, env.DB);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });
  if (user.role === "viewer") return json({ error: "forbidden" }, { status: 403 });
  const config = configured(env);
  if (!config) return json({ error: "journal_ai_not_configured" }, { status: 503 });

  let body: { journalId?: unknown } = {};
  try { body = await request.json(); } catch { return json({ error: "invalid_json" }, { status: 400 }); }
  const journalId = typeof body.journalId === "string" ? body.journalId : "";
  const journal = journalId ? await journalForUser(env, user.id, journalId) : null;
  if (!journal) return json({ error: "journal_not_found" }, { status: 404 });

  const existing = await env.DB.prepare(
    `SELECT id, question, answer, model, created_at AS createdAt, answered_at AS answeredAt
     FROM journal_followups WHERE journal_entry_id = ? AND user_id = ?
     ORDER BY created_at DESC LIMIT 1`,
  ).bind(journal.id, user.id).first<FollowupRow>();
  if (existing && !existing.answer) return json({ followup: existing });

  const count = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM journal_followups WHERE journal_entry_id = ? AND user_id = ?`,
  ).bind(journal.id, user.id).first<{ count: number }>();
  if (Number(count?.count ?? 0) >= 3) return json({ followup: null, complete: true });

  const context = await buildJournalContext(env, user.id, journal);
  const prompt = Number(count?.count ?? 0) === 0
    ? context
    : `${context}\n\nFortsæt refleksionen ud fra brugerens seneste svar. Hvis der ikke er mere konkret at uddybe, afslut kort uden at stille et nyt spørgsmål.`;
  const text = await callAnthropic(env, Number(count?.count ?? 0) === 0 ? JOURNAL_SYSTEM : FOLLOWUP_SYSTEM, prompt, 500);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO journal_followups
       (id, journal_entry_id, user_id, question, answer, model, created_at, answered_at)
     VALUES (?, ?, ?, ?, NULL, ?, ?, NULL)`,
  ).bind(id, journal.id, user.id, text, config.model, now).run();

  return json({ followup: { id, question: text, answer: null, model: config.model, createdAt: now, answeredAt: null } }, { status: 201 });
}

async function answer(request: Request, env: AiEnv): Promise<Response> {
  const user = await getAuthenticatedUser(request, env.DB);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });
  if (user.role === "viewer") return json({ error: "forbidden" }, { status: 403 });

  let body: { followupId?: unknown; answer?: unknown } = {};
  try { body = await request.json(); } catch { return json({ error: "invalid_json" }, { status: 400 }); }
  const followupId = typeof body.followupId === "string" ? body.followupId : "";
  const answerText = typeof body.answer === "string" ? body.answer.trim().slice(0, 5000) : "";
  if (!followupId || !answerText) return json({ error: "invalid_followup_answer" }, { status: 400 });

  const followup = await env.DB.prepare(
    `SELECT id, journal_entry_id AS journalEntryId, answer
     FROM journal_followups WHERE id = ? AND user_id = ? LIMIT 1`,
  ).bind(followupId, user.id).first<{ id: string; journalEntryId: string; answer: string | null }>();
  if (!followup) return json({ error: "followup_not_found" }, { status: 404 });
  if (followup.answer) return json({ error: "followup_already_answered" }, { status: 409 });

  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE journal_followups SET answer = ?, answered_at = ? WHERE id = ? AND user_id = ?`,
  ).bind(answerText, now, followup.id, user.id).run();

  return json({ ok: true, journalId: followup.journalEntryId, answeredAt: now });
}

async function dayFollowups(request: Request, env: AiEnv): Promise<Response> {
  const user = await getAuthenticatedUser(request, env.DB);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });
  const date = new URL(request.url).searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: "invalid_date" }, { status: 400 });

  const rows = await env.DB.prepare(
    `SELECT f.id, f.journal_entry_id AS journalEntryId, f.question, f.answer,
            f.model, f.created_at AS createdAt, f.answered_at AS answeredAt
     FROM journal_followups f
     JOIN journal_entries j ON j.id = f.journal_entry_id
     WHERE f.user_id = ? AND j.entry_date = ?
     ORDER BY f.created_at`,
  ).bind(user.id, date).all<Row>();
  return json({ followups: rows.results });
}

export async function handleJournalAiRoute(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/wellbeing/journal-ai/")) return null;
  const aiEnv = env as AiEnv;
  try {
    if (url.pathname === "/api/wellbeing/journal-ai/generate" && request.method === "POST") return generate(request, aiEnv);
    if (url.pathname === "/api/wellbeing/journal-ai/answer" && request.method === "POST") return answer(request, aiEnv);
    if (url.pathname === "/api/wellbeing/journal-ai/day" && request.method === "GET") return dayFollowups(request, aiEnv);
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "journal_ai_failed";
    console.error(JSON.stringify({ event: "journal_ai_failed", error: message }));
    return json({ error: message }, { status: message === "journal_ai_not_configured" ? 503 : 500 });
  }
}
