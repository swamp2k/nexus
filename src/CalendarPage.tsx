import { useEffect, useMemo, useState } from "react";

type CalendarSource = {
  id: string;
  name: string;
  enabled: boolean;
  host: string;
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

type EventsResponse = {
  events: CalendarEvent[];
  failures: Array<{ sourceId: string; sourceName: string; error: string }>;
};

type SourcesResponse = { sources: CalendarSource[] };
type LoadState = "loading" | "ready" | "error";

function localDayKey(value: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Copenhagen", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

function dayLabel(value: string): string {
  const date = new Date(`${value}T12:00:00`);
  const today = localDayKey(new Date().toISOString());
  const tomorrow = localDayKey(new Date(Date.now() + 86_400_000).toISOString());
  if (value === today) return "I dag";
  if (value === tomorrow) return "I morgen";
  return new Intl.DateTimeFormat("da-DK", { weekday: "long", day: "numeric", month: "long" }).format(date);
}

function eventTime(event: CalendarEvent): string {
  if (event.allDay) return "Hele dagen";
  const start = new Intl.DateTimeFormat("da-DK", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Copenhagen" }).format(new Date(event.start));
  if (!event.end) return start;
  const end = new Intl.DateTimeFormat("da-DK", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Copenhagen" }).format(new Date(event.end));
  return `${start}–${end}`;
}

export default function CalendarPage() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [sources, setSources] = useState<CalendarSource[]>([]);
  const [failures, setFailures] = useState<EventsResponse["failures"]>([]);
  const [state, setState] = useState<LoadState>("loading");

  async function load() {
    setState("loading");
    try {
      const [eventsResponse, sourcesResponse] = await Promise.all([
        fetch("/api/calendar/events?days=45", { credentials: "same-origin", cache: "no-store" }),
        fetch("/api/calendar/sources", { credentials: "same-origin", cache: "no-store" }),
      ]);
      if (!eventsResponse.ok || !sourcesResponse.ok) throw new Error("calendar_load_failed");
      const eventsBody = await eventsResponse.json() as EventsResponse;
      const sourcesBody = await sourcesResponse.json() as SourcesResponse;
      setEvents(eventsBody.events);
      setFailures(eventsBody.failures);
      setSources(sourcesBody.sources);
      setState("ready");
    } catch {
      setState("error");
    }
  }

  useEffect(() => { void load(); }, []);

  const groups = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of events) {
      const key = localDayKey(event.start);
      const list = map.get(key) ?? [];
      list.push(event);
      map.set(key, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [events]);

  return <section className="calendar-page" aria-label="Kalender">
    <div className="calendar-toolbar"><div><p className="section-label">iCal</p><h2>Kommende</h2><p>Læs-kun kalenderfeeds fra Google Calendar, Apple, Outlook og andre iCal-kilder.</p></div><button className="secondary-action" type="button" onClick={() => void load()}>Opdater</button></div>

    {state === "loading" && <p className="empty-state">Henter kalendere…</p>}
    {state === "error" && <p className="empty-state">Kalenderdata kunne ikke hentes.</p>}
    {state === "ready" && sources.length === 0 && <div className="calendar-empty"><strong>Ingen kalendere endnu</strong><span>Tilføj et iCal-feed under Indstillinger → Kalender · iCal.</span></div>}
    {state === "ready" && sources.length > 0 && groups.length === 0 && <div className="calendar-empty"><strong>Ingen kommende aftaler</strong><span>Der er ingen events i de næste 45 dage.</span></div>}

    {failures.length > 0 && <div className="calendar-warning"><strong>Nogle kalendere kunne ikke hentes</strong>{failures.map((failure) => <span key={failure.sourceId}>{failure.sourceName}: {failure.error}</span>)}</div>}

    <div className="calendar-agenda">{groups.map(([day, items]) => <section className="calendar-day" key={day}><header><strong>{dayLabel(day)}</strong><span>{new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "short" }).format(new Date(`${day}T12:00:00`))}</span></header><div>{items.map((event) => <article className="calendar-event" key={event.id}><time>{eventTime(event)}</time><div><strong>{event.title}</strong><span>{event.sourceName}{event.location ? ` · ${event.location}` : ""}</span>{event.description && <p>{event.description}</p>}</div></article>)}</div></section>)}</div>

    {sources.length > 0 && <p className="calendar-settings-note">Kalenderfeeds administreres under <strong>Indstillinger → Kalender · iCal</strong>.</p>}
  </section>;
}
