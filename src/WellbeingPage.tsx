import { useEffect, useMemo, useState } from "react";

type Metric = {
  id: string;
  name: string;
  emoji: string;
  direction: "high_good" | "high_bad";
};

type Entry = { metricId: string; value: number };
type Journal = { id: string; entryDate: string; body: string; createdAt: string };
type DayResponse = { date: string; metrics: Metric[]; entries: Entry[]; journals: Journal[] };

const goodFaces = ["😫", "😕", "😐", "🙂", "😁"];
const badFaces = ["😁", "🙂", "😐", "😕", "😫"];

function localDate(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function displayDate(value: string): string {
  return new Intl.DateTimeFormat("da-DK", { weekday: "long", day: "numeric", month: "long" }).format(new Date(`${value}T12:00:00`));
}

async function errorText(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: string; detail?: string };
    return body.detail ?? body.error ?? `HTTP ${response.status}`;
  } catch { return `HTTP ${response.status}`; }
}

export default function WellbeingPage() {
  const [date, setDate] = useState(localDate());
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [values, setValues] = useState<Record<string, number>>({});
  const [journals, setJournals] = useState<Journal[]>([]);
  const [journalText, setJournalText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [journalBusy, setJournalBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function load(target = date) {
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/wellbeing/day?date=${encodeURIComponent(target)}`, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error(await errorText(response));
      const body = await response.json() as DayResponse;
      setMetrics(body.metrics);
      setValues(Object.fromEntries(body.entries.map((entry) => [entry.metricId, entry.value])));
      setJournals(body.journals);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Kunne ikke hente dagens check-in.");
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(date); }, [date]);

  const completed = useMemo(() => metrics.filter((metric) => values[metric.id]).length, [metrics, values]);

  async function saveCheckIn() {
    setSaving(true); setMessage(null);
    try {
      const response = await fetch("/api/wellbeing/day", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, values }),
      });
      if (!response.ok) throw new Error(await errorText(response));
      setMessage("Dagens check-in er gemt.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Check-in kunne ikke gemmes.");
    } finally { setSaving(false); }
  }

  async function addJournal() {
    if (!journalText.trim()) return;
    setJournalBusy(true); setMessage(null);
    try {
      const response = await fetch("/api/wellbeing/journal", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, body: journalText.trim() }),
      });
      if (!response.ok) throw new Error(await errorText(response));
      const body = await response.json() as { journal: Journal };
      setJournals((current) => [body.journal, ...current]);
      setJournalText("");
      setMessage("Journalnotatet er gemt.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Journalnotatet kunne ikke gemmes.");
    } finally { setJournalBusy(false); }
  }

  async function removeJournal(id: string) {
    if (!window.confirm("Slet dette journalnotat?")) return;
    const response = await fetch(`/api/wellbeing/journal/${id}`, { method: "DELETE", credentials: "same-origin" });
    if (response.ok) setJournals((current) => current.filter((item) => item.id !== id));
  }

  return <section className="wellbeing-page">
    <div className="wellbeing-day-heading">
      <div><p className="section-label">Dagligt check-in</p><h2>{displayDate(date)}</h2><p>{metrics.length ? `${completed} af ${metrics.length} målepunkter udfyldt` : "Opret dine målepunkter under Indstillinger."}</p></div>
      <input type="date" value={date} onChange={(event) => setDate(event.target.value)} aria-label="Vælg dato" />
    </div>

    {loading ? <p className="empty-state">Henter check-in…</p> : metrics.length === 0 ? <section className="wellbeing-empty"><strong>Ingen målepunkter endnu</strong><p>Gå til Indstillinger → Velbefindende og opret de ting du vil følge dagligt.</p></section> : <section className="wellbeing-checkin">
      {metrics.map((metric) => {
        const faces = metric.direction === "high_bad" ? badFaces : goodFaces;
        return <article className="wellbeing-metric" key={metric.id}>
          <div className="wellbeing-metric-name"><span>{metric.emoji}</span><strong>{metric.name}</strong></div>
          <div className="wellbeing-score-row" role="radiogroup" aria-label={metric.name}>
            {faces.map((face, index) => {
              const value = index + 1;
              return <button key={value} type="button" className={values[metric.id] === value ? "active" : ""} onClick={() => setValues((current) => ({ ...current, [metric.id]: value }))} aria-label={`${metric.name}: ${value} af 5`} aria-pressed={values[metric.id] === value}><span>{face}</span><small>{value}</small></button>;
            })}
          </div>
        </article>;
      })}
      <button className="primary-action wellbeing-save" type="button" disabled={saving || completed === 0} onClick={() => void saveCheckIn()}>{saving ? "Gemmer…" : "Gem check-in"}</button>
    </section>}

    <section className="wellbeing-journal">
      <div><p className="section-label">Journal</p><h3>Noter fra dagen</h3><p>Skriv frit. Originalteksten gemmes uændret; AI-opfølgning kommer senere som et separat lag.</p></div>
      <textarea value={journalText} onChange={(event) => setJournalText(event.target.value)} rows={5} maxLength={20_000} placeholder="Hvad fyldte i dag? Hvad gik godt eller skidt?" />
      <div className="wellbeing-journal-actions"><button className="secondary-action" type="button" disabled={journalBusy || !journalText.trim()} onClick={() => void addJournal()}>{journalBusy ? "Gemmer…" : "Tilføj journalnotat"}</button></div>
      {journals.length > 0 && <div className="wellbeing-journal-list">{journals.map((journal) => <article key={journal.id}><p>{journal.body}</p><div><small>{new Intl.DateTimeFormat("da-DK", { timeStyle: "short" }).format(new Date(journal.createdAt))}</small><button type="button" onClick={() => void removeJournal(journal.id)}>Slet</button></div></article>)}</div>}
    </section>

    {message && <p className={`settings-feedback ${message.includes("gemt") ? "success" : "error"}`}>{message}</p>}
  </section>;
}
