import { useMemo } from "react";
import { useCachedJson } from "../data/queryCache";

type CalendarEvent = {
  id: string;
  title: string;
  start: string;
  allDay: boolean;
};

type EventsResponse = {
  events: CalendarEvent[];
  failures: Array<{ sourceId: string; sourceName: string; error: string }>;
};

type WasteKind = "rest" | "plast" | "papir";

type WasteMatch = {
  kind: WasteKind;
  label: string;
  icon: string;
  keywords: string[];
};

const WASTE_TYPES: WasteMatch[] = [
  { kind: "rest", label: "Rest", icon: "🗑️", keywords: ["rest", "madaffald", "mad affald"] },
  { kind: "plast", label: "Plast", icon: "♻️", keywords: ["plast"] },
  { kind: "papir", label: "Papir", icon: "📄", keywords: ["papir", "pap"] },
];

function normalize(value: string): string {
  return value.toLocaleLowerCase("da-DK").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9æøå]+/g, " ").trim();
}

function matchEvent(event: CalendarEvent, type: WasteMatch): boolean {
  const title = normalize(event.title);
  return type.keywords.some((keyword) => title.includes(normalize(keyword)));
}

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat("da-DK", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Copenhagen" }).format(new Date(value));
}

function daysUntil(value: string): string {
  const today = new Date();
  const target = new Date(value);
  const todayKey = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const targetParts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Copenhagen", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(target);
  const map = Object.fromEntries(targetParts.map((part) => [part.type, part.value]));
  const targetKey = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day));
  const days = Math.round((targetKey - todayKey) / 86_400_000);
  if (days === 0) return "i dag";
  if (days === 1) return "i morgen";
  return `om ${days} dage`;
}

export default function CalendarWasteWidget() {
  const { data, loading, error } = useCachedJson<EventsResponse>("/api/calendar/events?days=90", 15 * 60_000);
  const next = useMemo(() => {
    const events = data?.events ?? [];
    return WASTE_TYPES.map((type) => ({ type, event: events.find((event) => matchEvent(event, type)) ?? null }));
  }, [data]);

  if (loading) return <div className="home-widget-state">Henter affaldskalender…</div>;
  if (error || !data) return <div className="home-widget-state">Affaldskalenderen kunne ikke hentes</div>;
  if (!data.events.length) return <div className="home-widget-state">Ingen kalender-events fundet</div>;

  return <div className="home-waste-list">{next.map(({ type, event }) => <div className="home-waste-row" key={type.kind}>
    <span className="home-waste-icon" aria-hidden="true">{type.icon}</span>
    <div><strong>{type.label}</strong>{event ? <small>{event.title}</small> : <small>Ingen match de næste 90 dage</small>}</div>
    <div className="home-waste-date">{event ? <><strong>{dateLabel(event.start)}</strong><span>{daysUntil(event.start)}</span></> : <strong>—</strong>}</div>
  </div>)}</div>;
}
