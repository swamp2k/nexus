import { getAuthenticatedUser } from "../auth/session";
import { buildJournalContext, refreshHistoricalSummary } from "./journal-ai";

type MiyagiEnv = Env & {
  ANTHROPIC_API_KEY?: string;
  MIYAGI_MODEL?: string;
};

type DataRow = Record<string, unknown>;
type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  body: string;
  kind: "chat" | "checkin" | "legacy";
  analysisId: string | null;
  journalEntryId: string | null;
  createdAt: string;
};
type AnalysisLength = "short" | "normal" | "deep";
type AnalysisTone = "objective" | "empathetic" | "miyagi";
type WellbeingValueType = "scale" | "boolean";

type MiyagiContext = {
  generatedAt: string;
  period: { days: number; start: string; end: string };
  historicalJournalSummary: string | null;
  coverage: {
    healthDays: number;
    sleepDays: number;
    activityCount: number;
    checkInValues: number;
    journalEntries: number;
  };
  summary: {
    averageSleepHours: number | null;
    averageSteps: number | null;
    averageRestingHr: number | null;
    averageStress: number | null;
    averageBodyBatteryHigh: number | null;
    activities: number;
    activityHours: number;
    activityDistanceKm: number;
    wellbeingAverages: Array<{
      name: string;
      emoji: string;
      direction: string;
      valueType: WellbeingValueType;
      average: number | null;
      yesRate: number | null;
      yesCount: number | null;
      noCount: number | null;
      samples: number;
    }>;
  };
  days: Array<{
    date: string;
    health?: DataRow;
    sleep?: DataRow;
    activities?: Array<DataRow>;
    checkIns?: Array<DataRow>;
    journals?: Array<{ body: string; createdAt: string; truncated?: boolean }>;
  }>;
};

function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

async function recentConversation(db: D1Database, userId: string, limit = 50): Promise<ChatMessage[]> {
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
  ).bind(userId, limit).all<ChatMessage>();
  return rows.results;
}

function localIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function periodDates(days: number): { start: string; end: string } {
  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setUTCDate(startDate.getUTCDate() - (days - 1));
  return { start: localIsoDate(startDate), end: localIsoDate(endDate) };
}

function numeric(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function average(values: Array<number | null>): number | null {
  const usable = values.filter((value): value is number => value !== null);
  if (!usable.length) return null;
  return usable.reduce((sum, value) => sum + value, 0) / usable.length;
}

function rounded(value: number | null, digits = 1): number | null {
  if (value === null) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function dayForActivity(row: DataRow): string | null {
  const value = row.startTimeLocal ?? row.startTimeGmt;
  if (typeof value !== "string" || value.length < 10) return null;
  return value.slice(0, 10);
}

function pushMap<T>(map: Map<string, T[]>, key: string, value: T): void {
  const current = map.get(key) ?? [];
  current.push(value);
  map.set(key, current);
}

function truncateJournal(body: string): { body: string; truncated?: boolean } {
  const max = 2500;
  if (body.length <= max) return { body };
  return { body: `${body.slice(0, max)}…`, truncated: true };
}

async function buildContext(
  db: D1Database,
  userId: string,
  days: number,
  historicalJournalSummary: string | null,
): Promise<MiyagiContext> {
  const period = periodDates(days);
  const [health, sleep, activities, checkIns, journals] = await Promise.all([
    db.prepare(
      `SELECT date, steps, step_goal AS stepGoal, distance_m AS distanceM,
              resting_hr AS restingHr, min_hr AS minHr, max_hr AS maxHr,
              avg_stress AS avgStress, max_stress AS maxStress,
              body_battery_high AS bodyBatteryHigh, body_battery_low AS bodyBatteryLow,
              body_battery_charged AS bodyBatteryCharged, body_battery_drained AS bodyBatteryDrained,
              body_battery_latest AS bodyBatteryLatest, waking_respiration AS wakingRespiration,
              active_seconds AS activeSeconds, sedentary_seconds AS sedentarySeconds
       FROM garmin_daily
       WHERE user_id = ? AND date BETWEEN ? AND ?
       ORDER BY date`,
    ).bind(userId, period.start, period.end).all<DataRow>(),
    db.prepare(
      `SELECT date, sleep_seconds AS sleepSeconds, nap_seconds AS napSeconds,
              deep_seconds AS deepSeconds, light_seconds AS lightSeconds,
              rem_seconds AS remSeconds, awake_seconds AS awakeSeconds,
              avg_respiration AS avgRespiration, low_respiration AS lowRespiration,
              high_respiration AS highRespiration
       FROM garmin_sleep
       WHERE user_id = ? AND date BETWEEN ? AND ?
       ORDER BY date`,
    ).bind(userId, period.start, period.end).all<DataRow>(),
    db.prepare(
      `SELECT activity_id AS activityId, name, type,
              start_time_local AS startTimeLocal, start_time_gmt AS startTimeGmt,
              duration_seconds AS durationSeconds, moving_seconds AS movingSeconds,
              distance_m AS distanceM, calories, avg_hr AS avgHr, max_hr AS maxHr,
              steps, elevation_gain_m AS elevationGainM, elevation_loss_m AS elevationLossM,
              vo2max, location_name AS locationName
       FROM garmin_activities
       WHERE user_id = ?
         AND substr(COALESCE(start_time_local, start_time_gmt), 1, 10) BETWEEN ? AND ?
       ORDER BY COALESCE(start_time_local, start_time_gmt)`,
    ).bind(userId, period.start, period.end).all<DataRow>(),
    db.prepare(
      `SELECT e.entry_date AS entryDate, e.value,
              m.id AS metricId, m.name, m.emoji, m.direction, m.value_type AS valueType
       FROM wellbeing_entries e
       JOIN wellbeing_metrics m ON m.id = e.metric_id
       WHERE e.user_id = ? AND e.entry_date BETWEEN ? AND ?
       ORDER BY e.entry_date, m.sort_order`,
    ).bind(userId, period.start, period.end).all<DataRow>(),
    db.prepare(
      `SELECT entry_date AS entryDate, body, created_at AS createdAt
       FROM journal_entries
       WHERE user_id = ? AND entry_date BETWEEN ? AND ?
       ORDER BY entry_date, created_at`,
    ).bind(userId, period.start, period.end).all<DataRow>(),
  ]);

  const healthByDay = new Map(health.results.map((row) => [String(row.date), row]));
  const sleepByDay = new Map(sleep.results.map((row) => [String(row.date), row]));
  const activitiesByDay = new Map<string, DataRow[]>();
  const checkInsByDay = new Map<string, DataRow[]>();
  const journalsByDay = new Map<string, Array<{ body: string; createdAt: string; truncated?: boolean }>>();

  for (const row of activities.results) {
    const date = dayForActivity(row);
    if (date) pushMap(activitiesByDay, date, row);
  }
  for (const row of checkIns.results) {
    if (typeof row.entryDate === "string") pushMap(checkInsByDay, row.entryDate, row);
  }

  let journalCharacters = 0;
  const maxJournalCharacters = 30_000;
  for (const row of journals.results) {
    if (journalCharacters >= maxJournalCharacters) break;
    if (typeof row.entryDate !== "string" || typeof row.body !== "string") continue;
    const clipped = truncateJournal(row.body);
    const remaining = maxJournalCharacters - journalCharacters;
    if (clipped.body.length > remaining) {
      clipped.body = `${clipped.body.slice(0, Math.max(0, remaining - 1))}…`;
      clipped.truncated = true;
    }
    journalCharacters += clipped.body.length;
    pushMap(journalsByDay, row.entryDate, {
      ...clipped,
      createdAt: typeof row.createdAt === "string" ? row.createdAt : "",
    });
  }

  const allDates = new Set<string>([
    ...healthByDay.keys(),
    ...sleepByDay.keys(),
    ...activitiesByDay.keys(),
    ...checkInsByDay.keys(),
    ...journalsByDay.keys(),
  ]);

  const wellbeingGroups = new Map<string, { name: string; emoji: string; direction: string; valueType: WellbeingValueType; values: number[] }>();
  for (const row of checkIns.results) {
    const metricId = String(row.metricId ?? "");
    const value = numeric(row.value);
    if (!metricId || value === null) continue;
    const group = wellbeingGroups.get(metricId) ?? {
      name: String(row.name ?? "Målepunkt"),
      emoji: String(row.emoji ?? ""),
      direction: String(row.direction ?? "high_good"),
      valueType: row.valueType === "boolean" ? "boolean" : "scale",
      values: [],
    };
    group.values.push(value);
    wellbeingGroups.set(metricId, group);
  }

  const durationSeconds = activities.results.reduce((sum, row) => sum + (numeric(row.durationSeconds) ?? 0), 0);
  const distanceM = activities.results.reduce((sum, row) => sum + (numeric(row.distanceM) ?? 0), 0);

  return {
    generatedAt: new Date().toISOString(),
    period: { days, ...period },
    historicalJournalSummary,
    coverage: {
      healthDays: health.results.length,
      sleepDays: sleep.results.length,
      activityCount: activities.results.length,
      checkInValues: checkIns.results.length,
      journalEntries: journals.results.length,
    },
    summary: {
      averageSleepHours: rounded(average(sleep.results.map((row) => {
        const seconds = numeric(row.sleepSeconds);
        return seconds === null ? null : seconds / 3600;
      })), 2),
      averageSteps: rounded(average(health.results.map((row) => numeric(row.steps))), 0),
      averageRestingHr: rounded(average(health.results.map((row) => numeric(row.restingHr))), 1),
      averageStress: rounded(average(health.results.map((row) => numeric(row.avgStress))), 1),
      averageBodyBatteryHigh: rounded(average(health.results.map((row) => numeric(row.bodyBatteryHigh))), 1),
      activities: activities.results.length,
      activityHours: rounded(durationSeconds / 3600, 1) ?? 0,
      activityDistanceKm: rounded(distanceM / 1000, 1) ?? 0,
      wellbeingAverages: [...wellbeingGroups.values()].map((group) => {
        if (group.valueType === "boolean") {
          const yesCount = group.values.filter((value) => value === 1).length;
          const noCount = group.values.filter((value) => value === 0).length;
          const samples = yesCount + noCount;
          return {
            name: group.name,
            emoji: group.emoji,
            direction: group.direction,
            valueType: group.valueType,
            average: null,
            yesRate: samples ? rounded(yesCount / samples, 3) : null,
            yesCount,
            noCount,
            samples,
          };
        }
        return {
          name: group.name,
          emoji: group.emoji,
          direction: group.direction,
          valueType: group.valueType,
          average: rounded(average(group.values), 2),
          yesRate: null,
          yesCount: null,
          noCount: null,
          samples: group.values.length,
        };
      }),
    },
    days: [...allDates].sort().map((date) => ({
      date,
      health: healthByDay.get(date),
      sleep: sleepByDay.get(date),
      activities: activitiesByDay.get(date),
      checkIns: checkInsByDay.get(date),
      journals: journalsByDay.get(date),
    })),
  };
}

async function hashText(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function configured(env: MiyagiEnv): { key: string; model: string } | null {
  const key = env.ANTHROPIC_API_KEY?.trim();
  const model = env.MIYAGI_MODEL?.trim();
  return key && model ? { key, model } : null;
}

async function anthropicMessage(
  env: MiyagiEnv,
  system: string,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  maxTokens: number,
): Promise<string> {
  const config = configured(env);
  if (!config) throw new Error("miyagi_not_configured");

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
    console.error(JSON.stringify({ event: "miyagi_provider_error", status: response.status, detail: detail.slice(0, 500) }));
    throw new Error(`miyagi_provider_${response.status}`);
  }

  const payload = await response.json() as { content?: Array<{ type?: unknown; text?: unknown }> };
  const text = payload.content
    ?.filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => String(block.text))
    .join("\n")
    .trim();
  if (!text) throw new Error("miyagi_empty_response");
  return text;
}

const ANALYSIS_SYSTEM = `Du er Mr. Miyagi i Nexus, et privat personligt analyse- og refleksionsværktøj. Din vigtigste opgave er ikke at referere datasættet, men at opdage hvad der ser interessant ud på tværs af søvn, sundhed, aktivitet, subjektive check-ins og journal.

Grundregler:
- Svar på dansk.
- Skeln mellem observerede fakta, mønstre/sammenfald og hypoteser.
- Association er ikke kausalitet.
- Du er ikke læge. Stil ikke diagnoser, foreskriv ikke medicin, og fremstille ikke observationer som medicinske konklusioner.
- Opfind aldrig manglende data eller menneskelig kontekst.
- Journaltekst er brugerens egen tekst. Brug den som kontekst uden at omskrive brugerens historie.
- historicalJournalSummary er en kompakt AI-genereret hukommelse baseret kun på brugerskrevne journalnoter og tidligere brugerbeskeder. Brug den som baggrundskontekst, ikke som et ordret eller fejlfrit kildedokument. Rå data i analyseperioden vejer tungere ved konflikt.

Analyseprincipper:
- Vær INSIGHT-FIRST, ikke DATA-FIRST. Brug tal som dokumentation for et interessant fund, ikke som hovedindhold.
- Gentag ikke lange lister af datoer eller værdier. Et par konkrete eksempler eller et sample count er nok til at underbygge et fund.
- Spørg især: Hvad ændrede sig samtidigt? Hvad ser ud til at ske før eller efter? Gentager mønstret sig? Er der en positiv periode, som kan sammenlignes med en dårlig periode?
- Prioritér 2-5 mønstre der har potentiale til at fortælle brugeren noget nyt.
- Hvis en afvigende periode mangler forklaring i journal/check-ins, så sig hvad der ser anderledes ud og stil et konkret spørgsmål til brugeren om hvad der skete i perioden.
- Hvis subjektive check-ins findes, prioriter sammenhænge mellem dem og objektive data højt.
- Check-ins har eksplicit valueType. 'scale' betyder en 1–5-skala og kan opsummeres med gennemsnit. 'boolean' betyder Ja/Nej, hvor 1=Ja og 0=Nej; opsummer dem som andel Ja/Nej eller forekomster, aldrig som en 1–5-score. Manglende entry betyder ikke registreret / ikke relevant og må ikke behandles som Nej eller nul.
- For boolean check-ins er 'yesRate' en andel fra 0 til 1 af de faktisk registrerede svar. Fx 0.72 betyder 72% Ja blandt registrerede svar.
- Manglende sensorregistrering er ikke det samme som nul. Behandl åbenlyse nul-/missing-perioder som datakvalitet, ikke menneskelig adfærd.
- Undgå generiske råd. Giv hellere forslag til hvad der er værd at observere næste gang mønstret opstår.

Standardstruktur:
## Det vigtigste
En kort syntese af hvad datasættet samlet set ser ud til at fortælle.

## Mønstre jeg ville holde øje med
2-5 fund. Beskriv først betydningen; giv derefter kun den nødvendige dokumentation.

## Hvad kan hænge sammen?
Krydsreferér signalerne. Fremhæv særligt før/efter-forløb og perioder hvor flere signaler flytter sig sammen.

## Det mangler jeg at vide
Kun når det er nyttigt: 1-3 konkrete spørgsmål til brugeren, der kan forklare eller afkræfte interessante perioder.

## Datagrundlag
Meget kort. Kun dækning og væsentlige huller; ingen lang datarapport.`;

const CHAT_SYSTEM = `Du er Mr. Miyagi i Nexus og deltager i brugerens ene løbende samtale om velbefindende.

Den seneste gemte analyse er din primære analytiske kontekst. Samtalen kan også indeholde brugerens check-in kommentarer og dine tidligere refleksioner. Brug dem som menneskelig kontekst, men behandl aldrig AI-svar som brugerens egne fakta.

Regler:
- Svar på dansk.
- Skeln fakta, sammenfald og hypotese.
- Opfind aldrig manglende data eller menneskelig kontekst.
- Check-ins med valueType=boolean er Ja/Nej-data (1=Ja, 0=Nej); manglende entry er ikke registreret, ikke Nej. Behandl yesRate som en andel og aldrig som en 1–5-score.
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
- Dagens check-in, søvn, puls, stress, Body Battery, aktivitet og nyere journalhistorik må bruges, når det faktisk er relevant.
- Den seneste Miyagi-analyse må bruges som baggrund, men dagens rå kontekst vejer tungere, hvis noget har ændret sig siden analysen.
- Tidligere AI-svar er samtalekontekst, ikke bruger-authored ground truth.
- Skeln observation fra hypotese. Opfind aldrig hvorfor noget skete.
- Stil højst ét konkret, åbent opfølgende spørgsmål, hvis det kan gøre kommentaren mere nyttig senere.
- Du er ikke læge og skal ikke diagnosticere eller ordinere behandling.
- Hold svaret typisk under 180 ord.`;

function analysisPreferences(length: AnalysisLength, tone: AnalysisTone, focus: string): string {
  const lengthInstruction = length === "short"
    ? "Hold analysen kort: ca. 300-500 ord og højst 3 hovedfund."
    : length === "deep"
      ? "Lav en grundig analyse: typisk 900-1400 ord, men undgå fyld og rå datalister."
      : "Lav en fokuseret normal analyse: typisk 550-850 ord og 3-5 hovedfund.";

  const toneInstruction = tone === "objective"
    ? "Tone: nøgtern, analytisk og direkte."
    : tone === "empathetic"
      ? "Tone: empatisk, menneskelig og nysgerrig uden at blive terapeutisk eller overforsigtig."
      : "Tone: svar som en subtil moderne Mr. Miyagi-klon: rolig, varm, lidt tør humor og lejlighedsvis kort billedlig formulering. Ingen filmcitater, karikatur, gebrokkent sprog eller konstant pseudo-visdom. Indholdet skal stadig være præcist.";

  const focusInstruction = focus
    ? `Brugeren ønsker særligt fokus på: ${focus}`
    : "Brugeren har ikke angivet et særligt fokus. Find selv de mest interessante tværgående mønstre.";

  return `${lengthInstruction}\n${toneInstruction}\n${focusInstruction}`;
}

async function requireUser(request: Request, env: MiyagiEnv) {
  return getAuthenticatedUser(request, env.DB);
}

async function latestAnalysis(request: Request, env: MiyagiEnv): Promise<Response> {
  const user = await requireUser(request, env);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });

  const analysis = await env.DB.prepare(
    `SELECT id, period_days AS periodDays, period_start AS periodStart, period_end AS periodEnd,
            model, context_hash AS contextHash, analysis, created_at AS createdAt,
            focus, response_length AS responseLength, tone
     FROM miyagi_analyses WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`,
  ).bind(user.id).first<DataRow>();
  const messages = await recentConversation(env.DB, user.id, 50);
  if (!analysis) return json({ analysis: null, messages });

  return json({ analysis, messages });
}

async function createAnalysis(request: Request, env: MiyagiEnv): Promise<Response> {
  const user = await requireUser(request, env);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });
  if (user.role === "viewer") return json({ error: "forbidden" }, { status: 403 });
  const config = configured(env);
  if (!config) return json({ error: "miyagi_not_configured" }, { status: 503 });

  let body: { days?: unknown; focus?: unknown; length?: unknown; tone?: unknown } = {};
  try { body = await request.json(); } catch { /* optional body */ }
  const requested = Number(body.days ?? 90);
  const days = Math.max(30, Math.min(180, Number.isFinite(requested) ? Math.floor(requested) : 90));
  const focus = typeof body.focus === "string" ? body.focus.trim().slice(0, 1200) : "";
  const length: AnalysisLength = body.length === "normal" || body.length === "deep" ? body.length : "short";
  const tone: AnalysisTone = body.tone === "objective" || body.tone === "miyagi" ? body.tone : "empathetic";

  let historicalJournalSummary: string | null = null;
  try {
    historicalJournalSummary = await refreshHistoricalSummary(env, user.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "journal_summary_refresh_failed";
    console.error(JSON.stringify({ event: "miyagi_journal_summary_refresh_failed", error: message }));
  }

  const context = await buildContext(env.DB, user.id, days, historicalJournalSummary);
  if (context.coverage.healthDays + context.coverage.sleepDays + context.coverage.checkInValues + context.coverage.activityCount === 0) {
    return json({ error: "miyagi_no_data" }, { status: 422 });
  }

  const contextJson = JSON.stringify(context);
  const contextHash = await hashText(contextJson);
  const preferences = analysisPreferences(length, tone, focus);
  const maxTokens = length === "short" ? 1300 : length === "deep" ? 3200 : 2200;
  const analysisText = await anthropicMessage(
    env,
    ANALYSIS_SYSTEM,
    [{ role: "user", content: `${preferences}\n\nAnalyser dette Nexus-datasæt:\n\n${contextJson}` }],
    maxTokens,
  );

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO miyagi_analyses
       (id, user_id, period_days, period_start, period_end, model, context_json,
        context_hash, analysis, created_at, focus, response_length, tone)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id, user.id, days, context.period.start, context.period.end,
    config.model, contextJson, contextHash, analysisText, now,
    focus || null, length, tone,
  ).run();

  const messages = await recentConversation(env.DB, user.id, 50);
  return json({
    analysis: {
      id,
      periodDays: days,
      periodStart: context.period.start,
      periodEnd: context.period.end,
      model: config.model,
      contextHash,
      analysis: analysisText,
      createdAt: now,
      focus: focus || null,
      responseLength: length,
      tone,
      coverage: context.coverage,
    },
    messages,
  }, { status: 201 });
}

async function respondToCheckin(request: Request, env: MiyagiEnv): Promise<Response> {
  const user = await requireUser(request, env);
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

  if (existingReply) {
    return json({ messages: [userMessage, existingReply].filter(Boolean) });
  }

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

  const analysis = await env.DB.prepare(
    `SELECT id, context_json AS contextJson, analysis
     FROM miyagi_analyses
     WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT 1`,
  ).bind(user.id).first<{ id: string; contextJson: string; analysis: string }>();

  const historyRows = await env.DB.prepare(
    `SELECT role, body
     FROM (
       SELECT role, body, created_at
       FROM miyagi_conversation_messages
       WHERE user_id = ? AND kind <> 'legacy' AND created_at < ?
       ORDER BY created_at DESC
       LIMIT 20
     )
     ORDER BY created_at`,
  ).bind(user.id, journal.createdAt).all<{ role: "user" | "assistant"; body: string }>();

  const journalContext = await buildJournalContext(env, user.id, journal);
  const analysisContext = analysis
    ? `SENESTE MIYAGI-ANALYSE:\n${analysis.analysis}\n\nANALYSENS GEMTE DATASET:\n${analysis.contextJson}`
    : "SENESTE MIYAGI-ANALYSE:\n(ingen analyse endnu)";

  const prompt: Array<{ role: "user" | "assistant"; content: string }> = [
    {
      role: "user",
      content: `${analysisContext}\n\nKONTEKST FOR DAGENS CHECK-IN:\n${journalContext}`,
    },
    {
      role: "assistant",
      content: "Forstået. Jeg bruger dagens check-in som den aktuelle kilde og den seneste analyse som baggrund.",
    },
    ...historyRows.results.map((entry) => ({ role: entry.role, content: entry.body })),
    { role: "user", content: journal.body },
  ];

  const reply = await anthropicMessage(env, CHECKIN_SYSTEM, prompt, 650);
  const assistantMessage: ChatMessage = {
    id: crypto.randomUUID(),
    role: "assistant",
    body: reply,
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

  return json({ messages: [userMessage, assistantMessage] }, { status: 201 });
}

async function chat(request: Request, env: MiyagiEnv): Promise<Response> {
  const user = await requireUser(request, env);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });
  if (user.role === "viewer") return json({ error: "forbidden" }, { status: 403 });
  if (!configured(env)) return json({ error: "miyagi_not_configured" }, { status: 503 });

  let body: { analysisId?: unknown; message?: unknown } = {};
  try { body = await request.json(); } catch { return json({ error: "invalid_json" }, { status: 400 }); }
  const requestedAnalysisId = typeof body.analysisId === "string" ? body.analysisId : "";
  const message = typeof body.message === "string" ? body.message.trim().slice(0, 4000) : "";
  if (!message) return json({ error: "invalid_chat" }, { status: 400 });

  const analysis = requestedAnalysisId
    ? await env.DB.prepare(
        `SELECT id, context_json AS contextJson, analysis
         FROM miyagi_analyses WHERE id = ? AND user_id = ? LIMIT 1`,
      ).bind(requestedAnalysisId, user.id).first<{ id: string; contextJson: string; analysis: string }>()
    : await env.DB.prepare(
        `SELECT id, context_json AS contextJson, analysis
         FROM miyagi_analyses WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`,
      ).bind(user.id).first<{ id: string; contextJson: string; analysis: string }>();

  if (requestedAnalysisId && !analysis) return json({ error: "analysis_not_found" }, { status: 404 });

  const history = await recentConversation(env.DB, user.id, 30);
  const analysisContext = analysis
    ? `Her er det låste datasæt og den seneste analyse, som er den aktuelle analytiske baggrund.\n\nDATASET:\n${analysis.contextJson}\n\nANALYSE:\n${analysis.analysis}`
    : "Der er endnu ingen gemt Miyagi-analyse. Brug kun den løbende samtale som kontekst og sig tydeligt, hvis et spørgsmål kræver strukturerede Nexus-data, du ikke har i denne samtale.";

  const messages: Array<{ role: "user" | "assistant"; content: string }> = [
    { role: "user", content: analysisContext },
    {
      role: "assistant",
      content: analysis
        ? "Forstået. Jeg bruger analysen som baggrund og den løbende samtale som menneskelig kontekst."
        : "Forstået. Jeg holder mig til samtalen og foregiver ikke at have en analyse, der ikke findes.",
    },
    ...history.map((entry) => ({ role: entry.role, content: entry.body })),
    { role: "user", content: message },
  ];

  const userCreatedAt = new Date().toISOString();
  const reply = await anthropicMessage(env, CHAT_SYSTEM, messages, 1200);
  const activeAnalysisId = analysis?.id ?? null;
  const userMessage: ChatMessage = {
    id: crypto.randomUUID(),
    role: "user",
    body: message,
    kind: "chat",
    analysisId: activeAnalysisId,
    journalEntryId: null,
    createdAt: userCreatedAt,
  };
  const assistantMessage: ChatMessage = {
    id: crypto.randomUUID(),
    role: "assistant",
    body: reply,
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

  return json({ messages: [userMessage, assistantMessage] });
}

export async function handleMiyagiRoute(request: Request, env: Env): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  const miyagiEnv = env as MiyagiEnv;
  try {
    if (pathname === "/api/wellbeing/miyagi/latest" && request.method === "GET") return latestAnalysis(request, miyagiEnv);
    if (pathname === "/api/wellbeing/miyagi/analyze" && request.method === "POST") return createAnalysis(request, miyagiEnv);
    if (pathname === "/api/wellbeing/miyagi/checkin" && request.method === "POST") return respondToCheckin(request, miyagiEnv);
    if (pathname === "/api/wellbeing/miyagi/chat" && request.method === "POST") return chat(request, miyagiEnv);
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "miyagi_failed";
    console.error(JSON.stringify({ event: "miyagi_failed", error: message }));
    return json({ error: message }, { status: message === "miyagi_not_configured" ? 503 : 500 });
  }
}
