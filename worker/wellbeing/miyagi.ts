import { getAuthenticatedUser } from "../auth/session";

type MiyagiEnv = Env & {
  ANTHROPIC_API_KEY?: string;
  MIYAGI_MODEL?: string;
};

type DataRow = Record<string, unknown>;
type ChatMessage = { role: "user" | "assistant"; body: string; createdAt: string };

type MiyagiContext = {
  generatedAt: string;
  period: { days: number; start: string; end: string };
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
    wellbeingAverages: Array<{ name: string; emoji: string; direction: string; average: number; samples: number }>;
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

async function buildContext(db: D1Database, userId: string, days: number): Promise<MiyagiContext> {
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
              m.id AS metricId, m.name, m.emoji, m.direction
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

  const wellbeingGroups = new Map<string, { name: string; emoji: string; direction: string; values: number[] }>();
  for (const row of checkIns.results) {
    const metricId = String(row.metricId ?? "");
    const value = numeric(row.value);
    if (!metricId || value === null) continue;
    const group = wellbeingGroups.get(metricId) ?? {
      name: String(row.name ?? "Målepunkt"),
      emoji: String(row.emoji ?? ""),
      direction: String(row.direction ?? "high_good"),
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
      wellbeingAverages: [...wellbeingGroups.values()].map((group) => ({
        name: group.name,
        emoji: group.emoji,
        direction: group.direction,
        average: rounded(average(group.values), 2) ?? 0,
        samples: group.values.length,
      })),
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
    body: JSON.stringify({
      model: config.model,
      max_tokens: maxTokens,
      temperature: 0.25,
      system,
      messages,
    }),
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

const ANALYSIS_SYSTEM = `Du er Mr. Miyagi i Nexus, et privat personligt analyseværktøj. Din opgave er at hjælpe brugeren med at opdage mønstre mellem søvn, sundhedsdata, aktiviteter, subjektive check-ins og journalnoter.

Regler:
- Svar på dansk.
- Vær varm, rolig, konkret og kortfattet. Ingen rollespils-karikatur eller pseudo-visdom.
- Skeln tydeligt mellem fakta i datasættet, mønstre/sammenfald og hypoteser.
- Association er ikke kausalitet.
- Du er ikke læge. Stil ikke diagnoser, foreskriv ikke medicin, og fremstille ikke observationer som medicinske konklusioner.
- Henvis til konkrete datoer, perioder, antal observationer eller målepunkter når du beskriver et mønster.
- Hvis datadækningen er for tynd til en konklusion, sig det eksplicit.
- Journaltekst er brugerens egen tekst. Opsummer den respektfuldt; opfind ikke hændelser.
- Prioriter 3-6 fund der faktisk er nyttige frem for at kommentere på alt.

Strukturér analysen med disse overskrifter:
## Kort fortalt
## Det jeg lægger mærke til
## Mulige sammenfald
## Hvad der er værd at holde øje med
## Datagrundlag

I Datagrundlag skal du kort beskrive dækningen og eventuelle væsentlige huller.`;

const CHAT_SYSTEM = `Du er Mr. Miyagi i Nexus. Du svarer på opfølgende spørgsmål til en allerede gennemført personlig dataanalyse.

Regler:
- Svar på dansk og hold dig til det gemte datasæt og den gemte analyse.
- Skeln fakta, sammenfald og hypotese.
- Opfind aldrig manglende data.
- Du er ikke læge og må ikke stille diagnoser eller ordinere behandling.
- Praktiske, lavrisiko refleksioner og forslag til ting brugeren kan observere eller afprøve er fine.
- Hvis spørgsmålet kræver data, som ikke findes i context, sig det direkte.`;

async function requireUser(request: Request, env: MiyagiEnv) {
  return getAuthenticatedUser(request, env.DB);
}

async function latestAnalysis(request: Request, env: MiyagiEnv): Promise<Response> {
  const user = await requireUser(request, env);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });

  const analysis = await env.DB.prepare(
    `SELECT id, period_days AS periodDays, period_start AS periodStart, period_end AS periodEnd,
            model, context_hash AS contextHash, analysis, created_at AS createdAt
     FROM miyagi_analyses WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`,
  ).bind(user.id).first<DataRow>();
  if (!analysis) return json({ analysis: null, messages: [] });

  const messages = await env.DB.prepare(
    `SELECT role, body, created_at AS createdAt
     FROM miyagi_messages WHERE analysis_id = ? AND user_id = ?
     ORDER BY created_at LIMIT 50`,
  ).bind(String(analysis.id), user.id).all<ChatMessage>();

  return json({ analysis, messages: messages.results });
}

async function createAnalysis(request: Request, env: MiyagiEnv): Promise<Response> {
  const user = await requireUser(request, env);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });
  if (user.role === "viewer") return json({ error: "forbidden" }, { status: 403 });
  const config = configured(env);
  if (!config) return json({ error: "miyagi_not_configured" }, { status: 503 });

  let body: { days?: unknown } = {};
  try { body = await request.json(); } catch { /* optional body */ }
  const requested = Number(body.days ?? 90);
  const days = Math.max(30, Math.min(180, Number.isFinite(requested) ? Math.floor(requested) : 90));

  const context = await buildContext(env.DB, user.id, days);
  if (context.coverage.healthDays + context.coverage.sleepDays + context.coverage.checkInValues + context.coverage.activityCount === 0) {
    return json({ error: "miyagi_no_data" }, { status: 422 });
  }

  const contextJson = JSON.stringify(context);
  const contextHash = await hashText(contextJson);
  const analysisText = await anthropicMessage(
    env,
    ANALYSIS_SYSTEM,
    [{ role: "user", content: `Analyser dette Nexus-datasæt:\n\n${contextJson}` }],
    2200,
  );

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO miyagi_analyses
       (id, user_id, period_days, period_start, period_end, model, context_json, context_hash, analysis, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id, user.id, days, context.period.start, context.period.end,
    config.model, contextJson, contextHash, analysisText, now,
  ).run();

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
      coverage: context.coverage,
    },
    messages: [],
  }, { status: 201 });
}

async function chat(request: Request, env: MiyagiEnv): Promise<Response> {
  const user = await requireUser(request, env);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });
  if (user.role === "viewer") return json({ error: "forbidden" }, { status: 403 });
  if (!configured(env)) return json({ error: "miyagi_not_configured" }, { status: 503 });

  let body: { analysisId?: unknown; message?: unknown } = {};
  try { body = await request.json(); } catch { return json({ error: "invalid_json" }, { status: 400 }); }
  const analysisId = typeof body.analysisId === "string" ? body.analysisId : "";
  const message = typeof body.message === "string" ? body.message.trim().slice(0, 4000) : "";
  if (!analysisId || !message) return json({ error: "invalid_chat" }, { status: 400 });

  const analysis = await env.DB.prepare(
    `SELECT id, context_json AS contextJson, analysis
     FROM miyagi_analyses WHERE id = ? AND user_id = ? LIMIT 1`,
  ).bind(analysisId, user.id).first<{ id: string; contextJson: string; analysis: string }>();
  if (!analysis) return json({ error: "analysis_not_found" }, { status: 404 });

  const history = await env.DB.prepare(
    `SELECT role, body, created_at AS createdAt
     FROM miyagi_messages WHERE analysis_id = ? AND user_id = ?
     ORDER BY created_at LIMIT 30`,
  ).bind(analysisId, user.id).all<ChatMessage>();

  const messages: Array<{ role: "user" | "assistant"; content: string }> = [
    {
      role: "user",
      content: `Her er det låste datasæt og den analyse samtalen handler om.\n\nDATASET:\n${analysis.contextJson}\n\nANALYSE:\n${analysis.analysis}`,
    },
    {
      role: "assistant",
      content: "Forstået. Jeg holder mig til dette datasæt og denne analyse.",
    },
    ...history.results.map((entry) => ({ role: entry.role, content: entry.body })),
    { role: "user", content: message },
  ];

  const reply = await anthropicMessage(env, CHAT_SYSTEM, messages, 1200);
  const now = new Date().toISOString();
  const userMessage = { id: crypto.randomUUID(), role: "user" as const, body: message, createdAt: now };
  const assistantMessage = { id: crypto.randomUUID(), role: "assistant" as const, body: reply, createdAt: new Date().toISOString() };

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO miyagi_messages (id, analysis_id, user_id, role, body, created_at)
       VALUES (?, ?, ?, 'user', ?, ?)`,
    ).bind(userMessage.id, analysisId, user.id, userMessage.body, userMessage.createdAt),
    env.DB.prepare(
      `INSERT INTO miyagi_messages (id, analysis_id, user_id, role, body, created_at)
       VALUES (?, ?, ?, 'assistant', ?, ?)`,
    ).bind(assistantMessage.id, analysisId, user.id, assistantMessage.body, assistantMessage.createdAt),
  ]);

  return json({ messages: [userMessage, assistantMessage] });
}

export async function handleMiyagiRoute(request: Request, env: Env): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  const miyagiEnv = env as MiyagiEnv;
  try {
    if (pathname === "/api/wellbeing/miyagi/latest" && request.method === "GET") return latestAnalysis(request, miyagiEnv);
    if (pathname === "/api/wellbeing/miyagi/analyze" && request.method === "POST") return createAnalysis(request, miyagiEnv);
    if (pathname === "/api/wellbeing/miyagi/chat" && request.method === "POST") return chat(request, miyagiEnv);
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "miyagi_failed";
    console.error(JSON.stringify({ event: "miyagi_failed", error: message }));
    return json({ error: message }, { status: message === "miyagi_not_configured" ? 503 : 500 });
  }
}
