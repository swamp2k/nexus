import { getAuthenticatedUser } from "../auth/session";

type SourceRow = {
  id: string;
  name: string;
  url: string;
  enabled: number;
  updatedAt: string;
};

type CalendarEvent = {
  id: string;
  uid: string;
  sourceId: string;
  sourceName: string;
  title: string;
  start: string;
  end: string | null;
  allDay: boolean;
  location: string | null;
  description: string | null;
};

type ParsedEvent = {
  uid: string;
  title: string;
  start: Date;
  end: Date | null;
  allDay: boolean;
  location: string | null;
  description: string | null;
  rrule: Record<string, string> | null;
  exdates: Set<string>;
};

const DAY = 86_400_000;
const WEEKDAY: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

function cleanText(value: string): string {
  return value.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\").trim();
}

function normalizeUrl(value: string): URL | null {
  const input = value.trim().replace(/^webcal:\/\//i, "https://");
  try {
    const url = new URL(input);
    if (url.protocol !== "https:") return null;
    if (!url.hostname || url.username || url.password) return null;
    if (url.hostname === "localhost" || url.hostname.endsWith(".localhost")) return null;
    return url;
  } catch {
    return null;
  }
}

function timezoneOffsetMs(epochMs: number, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    }).formatToParts(new Date(epochMs));
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const asUtc = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), Number(map.hour), Number(map.minute), Number(map.second));
    return asUtc - Math.floor(epochMs / 1000) * 1000;
  } catch {
    return 0;
  }
}

function zonedDate(y: number, m: number, d: number, hh: number, mm: number, ss: number, tz: string): Date {
  const wall = Date.UTC(y, m - 1, d, hh, mm, ss);
  let utc = wall - timezoneOffsetMs(wall, tz);
  utc = wall - timezoneOffsetMs(utc, tz);
  return new Date(utc);
}

function parseDateValue(value: string, params: Record<string, string>): { date: Date; allDay: boolean } | null {
  const raw = value.trim();
  if (/^\d{8}$/.test(raw)) {
    const y = Number(raw.slice(0, 4)), m = Number(raw.slice(4, 6)), d = Number(raw.slice(6, 8));
    return { date: new Date(Date.UTC(y, m - 1, d)), allDay: true };
  }
  const match = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (!match) return null;
  const [, ys, ms, ds, hs, mins, ss, z] = match;
  const y = Number(ys), m = Number(ms), d = Number(ds), hh = Number(hs), mm = Number(mins), sec = Number(ss);
  if (z) return { date: new Date(Date.UTC(y, m - 1, d, hh, mm, sec)), allDay: false };
  const tz = params.TZID?.replace(/^"|"$/g, "") || "Europe/Copenhagen";
  return { date: zonedDate(y, m, d, hh, mm, sec, tz), allDay: false };
}

function eventDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function unfold(text: string): string[] {
  return text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
}

function parseProperty(line: string): { name: string; params: Record<string, string>; value: string } | null {
  const colon = line.indexOf(":");
  if (colon < 0) return null;
  const left = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const parts = left.split(";");
  const name = parts.shift()?.toUpperCase() ?? "";
  const params: Record<string, string> = {};
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq > 0) params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }
  return { name, params, value };
}

function parseRrule(value: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of value.split(";")) {
    const [key, raw] = part.split("=", 2);
    if (key && raw) result[key.toUpperCase()] = raw;
  }
  return result;
}

function parseIcs(text: string): ParsedEvent[] {
  const lines = unfold(text);
  const result: ParsedEvent[] = [];
  let current: {
    uid?: string; title?: string; start?: Date; end?: Date | null; allDay?: boolean;
    location?: string | null; description?: string | null; rrule?: Record<string, string> | null; exdates: Set<string>;
  } | null = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { current = { exdates: new Set() }; continue; }
    if (line === "END:VEVENT") {
      if (current?.uid && current.start) {
        result.push({
          uid: current.uid,
          title: current.title || "(uden titel)",
          start: current.start,
          end: current.end ?? null,
          allDay: Boolean(current.allDay),
          location: current.location ?? null,
          description: current.description ?? null,
          rrule: current.rrule ?? null,
          exdates: current.exdates,
        });
      }
      current = null;
      continue;
    }
    if (!current) continue;
    const prop = parseProperty(line);
    if (!prop) continue;
    if (prop.name === "UID") current.uid = cleanText(prop.value);
    else if (prop.name === "SUMMARY") current.title = cleanText(prop.value);
    else if (prop.name === "LOCATION") current.location = cleanText(prop.value) || null;
    else if (prop.name === "DESCRIPTION") current.description = cleanText(prop.value) || null;
    else if (prop.name === "DTSTART") {
      const parsed = parseDateValue(prop.value, prop.params);
      if (parsed) { current.start = parsed.date; current.allDay = parsed.allDay; }
    } else if (prop.name === "DTEND") {
      const parsed = parseDateValue(prop.value, prop.params);
      if (parsed) current.end = parsed.date;
    } else if (prop.name === "RRULE") current.rrule = parseRrule(prop.value);
    else if (prop.name === "EXDATE") {
      for (const raw of prop.value.split(",")) {
        const parsed = parseDateValue(raw, prop.params);
        if (parsed) current.exdates.add(eventDateKey(parsed.date));
      }
    }
  }
  return result;
}

function addMonths(date: Date, months: number): Date {
  const copy = new Date(date);
  copy.setUTCMonth(copy.getUTCMonth() + months);
  return copy;
}

function recurringInstances(event: ParsedEvent, from: Date, to: Date): Array<{ start: Date; end: Date | null }> {
  if (!event.rrule) return [{ start: event.start, end: event.end }];
  const rule = event.rrule;
  const freq = rule.FREQ;
  const interval = Math.max(1, Number(rule.INTERVAL) || 1);
  const count = Math.max(0, Number(rule.COUNT) || 0);
  const untilParsed = rule.UNTIL ? parseDateValue(rule.UNTIL, {})?.date ?? null : null;
  const byDays = (rule.BYDAY ?? "").split(",").map((value) => value.replace(/^[+-]?\d+/, "")).map((value) => WEEKDAY[value]).filter((value) => value !== undefined);
  const duration = event.end ? event.end.getTime() - event.start.getTime() : null;
  const instances: Array<{ start: Date; end: Date | null }> = [];
  let emitted = 0;

  if (freq === "WEEKLY" && byDays.length) {
    const cursor = new Date(Math.max(from.getTime() - 7 * DAY, event.start.getTime()));
    cursor.setUTCHours(event.start.getUTCHours(), event.start.getUTCMinutes(), event.start.getUTCSeconds(), 0);
    for (let i = 0; i < 800 && cursor <= to; i += 1, cursor.setUTCDate(cursor.getUTCDate() + 1)) {
      if (cursor < event.start) continue;
      const dayDiff = Math.floor((Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate()) - Date.UTC(event.start.getUTCFullYear(), event.start.getUTCMonth(), event.start.getUTCDate())) / DAY);
      const weekDiff = Math.floor(dayDiff / 7);
      if (weekDiff % interval !== 0 || !byDays.includes(cursor.getUTCDay())) continue;
      emitted += 1;
      if (count && emitted > count) break;
      if (untilParsed && cursor > untilParsed) break;
      if (!event.exdates.has(eventDateKey(cursor)) && cursor >= from && cursor <= to) instances.push({ start: new Date(cursor), end: duration === null ? null : new Date(cursor.getTime() + duration) });
    }
    return instances;
  }

  let cursor = new Date(event.start);
  for (let i = 0; i < 1000 && cursor <= to; i += 1) {
    emitted += 1;
    if (count && emitted > count) break;
    if (untilParsed && cursor > untilParsed) break;
    const dayAllowed = !byDays.length || byDays.includes(cursor.getUTCDay());
    if (dayAllowed && !event.exdates.has(eventDateKey(cursor)) && cursor >= from && cursor <= to) instances.push({ start: new Date(cursor), end: duration === null ? null : new Date(cursor.getTime() + duration) });
    if (freq === "DAILY") cursor = new Date(cursor.getTime() + interval * DAY);
    else if (freq === "WEEKLY") cursor = new Date(cursor.getTime() + interval * 7 * DAY);
    else if (freq === "MONTHLY") cursor = addMonths(cursor, interval);
    else if (freq === "YEARLY") { const next = new Date(cursor); next.setUTCFullYear(next.getUTCFullYear() + interval); cursor = next; }
    else break;
  }
  return instances;
}

async function fetchCalendar(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, { headers: { Accept: "text/calendar,text/plain;q=0.9,*/*;q=0.1" }, signal: controller.signal, redirect: "follow" });
    if (!response.ok) throw new Error(`calendar_http_${response.status}`);
    const text = await response.text();
    if (text.length > 2_000_000) throw new Error("calendar_too_large");
    if (!text.includes("BEGIN:VCALENDAR")) throw new Error("calendar_not_ics");
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

async function requireUser(request: Request, env: Env) {
  return getAuthenticatedUser(request, env.DB);
}

async function listSources(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });
  const rows = await env.DB.prepare(`SELECT id,name,url,enabled,updated_at AS updatedAt FROM calendar_sources WHERE user_id=? ORDER BY name`).bind(user.id).all<SourceRow>();
  return json({ sources: rows.results.map((row) => ({ id: row.id, name: row.name, enabled: row.enabled === 1, host: new URL(row.url).hostname, updatedAt: row.updatedAt })) });
}

async function createSource(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });
  if (user.role === "viewer") return json({ error: "forbidden" }, { status: 403 });
  let body: { name?: unknown; url?: unknown } = {};
  try { body = await request.json(); } catch { return json({ error: "invalid_json" }, { status: 400 }); }
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
  const url = typeof body.url === "string" ? normalizeUrl(body.url) : null;
  if (!name || !url || url.toString().length > 2048) return json({ error: "invalid_calendar_source" }, { status: 400 });
  try { await fetchCalendar(url.toString()); } catch (error) { return json({ error: error instanceof Error ? error.message : "calendar_fetch_failed" }, { status: 422 }); }
  const id = crypto.randomUUID(), now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO calendar_sources (id,user_id,name,url,enabled,created_at,updated_at) VALUES (?,?,?,?,1,?,?)`).bind(id, user.id, name, url.toString(), now, now).run();
  return json({ source: { id, name, enabled: true, host: url.hostname, updatedAt: now } }, { status: 201 });
}

async function updateSource(request: Request, env: Env, id: string): Promise<Response> {
  const user = await requireUser(request, env);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });
  if (user.role === "viewer") return json({ error: "forbidden" }, { status: 403 });
  let body: { name?: unknown; enabled?: unknown } = {};
  try { body = await request.json(); } catch { return json({ error: "invalid_json" }, { status: 400 }); }
  const current = await env.DB.prepare(`SELECT id,name,url,enabled,updated_at AS updatedAt FROM calendar_sources WHERE id=? AND user_id=?`).bind(id, user.id).first<SourceRow>();
  if (!current) return json({ error: "not_found" }, { status: 404 });
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : current.name;
  const enabled = typeof body.enabled === "boolean" ? (body.enabled ? 1 : 0) : current.enabled;
  if (!name) return json({ error: "invalid_calendar_source" }, { status: 400 });
  const now = new Date().toISOString();
  await env.DB.prepare(`UPDATE calendar_sources SET name=?,enabled=?,updated_at=? WHERE id=? AND user_id=?`).bind(name, enabled, now, id, user.id).run();
  return json({ source: { id, name, enabled: enabled === 1, host: new URL(current.url).hostname, updatedAt: now } });
}

async function deleteSource(request: Request, env: Env, id: string): Promise<Response> {
  const user = await requireUser(request, env);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });
  if (user.role === "viewer") return json({ error: "forbidden" }, { status: 403 });
  await env.DB.prepare(`DELETE FROM calendar_sources WHERE id=? AND user_id=?`).bind(id, user.id).run();
  return json({ ok: true });
}

async function readPreferences(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });
  const row = await env.DB.prepare(`SELECT waste_warning_days AS wasteWarningDays, updated_at AS updatedAt FROM calendar_preferences WHERE user_id=?`).bind(user.id).first<{ wasteWarningDays: number; updatedAt: string }>();
  return json({ preferences: { wasteWarningDays: row?.wasteWarningDays ?? 1, updatedAt: row?.updatedAt ?? null } });
}

async function updatePreferences(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });
  if (user.role === "viewer") return json({ error: "forbidden" }, { status: 403 });
  let body: { wasteWarningDays?: unknown } = {};
  try { body = await request.json(); } catch { return json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = typeof body.wasteWarningDays === "number" ? body.wasteWarningDays : Number(body.wasteWarningDays);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 7) return json({ error: "invalid_calendar_preferences" }, { status: 400 });
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO calendar_preferences (user_id,waste_warning_days,updated_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET waste_warning_days=excluded.waste_warning_days,updated_at=excluded.updated_at`).bind(user.id, parsed, now).run();
  return json({ preferences: { wasteWarningDays: parsed, updatedAt: now } });
}

async function events(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const days = Math.max(1, Math.min(90, Number(url.searchParams.get("days")) || 30));
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const to = new Date(from.getTime() + days * DAY);
  const rows = await env.DB.prepare(`SELECT id,name,url,enabled,updated_at AS updatedAt FROM calendar_sources WHERE user_id=? AND enabled=1 ORDER BY name`).bind(user.id).all<SourceRow>();
  const failures: Array<{ sourceId: string; sourceName: string; error: string }> = [];
  const chunks = await Promise.all(rows.results.map(async (source): Promise<CalendarEvent[]> => {
    try {
      const text = await fetchCalendar(source.url);
      const parsed = parseIcs(text);
      const output: CalendarEvent[] = [];
      for (const event of parsed) {
        for (const instance of recurringInstances(event, from, to)) {
          const end = instance.end;
          if ((end ?? instance.start) < from || instance.start > to) continue;
          output.push({
            id: `${source.id}:${event.uid}:${instance.start.toISOString()}`,
            uid: event.uid,
            sourceId: source.id,
            sourceName: source.name,
            title: event.title,
            start: instance.start.toISOString(),
            end: end?.toISOString() ?? null,
            allDay: event.allDay,
            location: event.location,
            description: event.description,
          });
        }
      }
      return output;
    } catch (error) {
      failures.push({ sourceId: source.id, sourceName: source.name, error: error instanceof Error ? error.message : "calendar_fetch_failed" });
      return [];
    }
  }));
  const all = chunks.flat().sort((a, b) => Date.parse(a.start) - Date.parse(b.start)).slice(0, 500);
  return json({ events: all, failures, range: { from: from.toISOString(), to: to.toISOString() } });
}

export async function handleCalendarRoute(request: Request, env: Env): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  if (pathname === "/api/calendar/sources" && request.method === "GET") return listSources(request, env);
  if (pathname === "/api/calendar/sources" && request.method === "POST") return createSource(request, env);
  const match = pathname.match(/^\/api\/calendar\/sources\/([^/]+)$/);
  if (match && request.method === "PUT") return updateSource(request, env, decodeURIComponent(match[1]));
  if (match && request.method === "DELETE") return deleteSource(request, env, decodeURIComponent(match[1]));
  if (pathname === "/api/calendar/preferences" && request.method === "GET") return readPreferences(request, env);
  if (pathname === "/api/calendar/preferences" && request.method === "PUT") return updatePreferences(request, env);
  if (pathname === "/api/calendar/events" && request.method === "GET") return events(request, env);
  return null;
}
