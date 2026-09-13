import { useEffect, useMemo, useState } from "react";
import MiyagiWorkspace from "./MiyagiWorkspace";
import MiyagiMarkdown from "./MiyagiMarkdown";
import WellbeingHistory from "./WellbeingHistory";

type MetricValueType = "scale" | "boolean";
type Metric = {
  id: string;
  name: string;
  emoji: string;
  direction: "high_good" | "high_bad";
  valueType: MetricValueType;
};

type MetricValue = number | null;
type Entry = { metricId: string; value: number };
type Journal = { id: string; entryDate: string; body: string; createdAt: string };
type ConversationMessage = {
  id: string;
  role: "user" | "assistant";
  body: string;
  kind: "checkin";
  analysisId?: string | null;
  journalEntryId: string | null;
  subjectDate?: string | null;
  createdAt: string;
};
type DayResponse = { date: string; metrics: Metric[]; entries: Entry[]; journals: Journal[] };

type ThreadResponse = { date?: string; messages: ConversationMessage[] };

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

function displayTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("da-DK", { dateStyle: "short", timeStyle: "short" }).format(parsed);
}

function metricValueLabel(metric: Metric, value: MetricValue): string {
  if (value === null || value === undefined) return "—";
  if (metric.valueType === "boolean") return value === 1 ? "Ja" : "Nej";
  return `${value}/5`;
}

function mergeMessages(current: ConversationMessage[], incoming: ConversationMessage[]): ConversationMessage[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

async function errorText(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: string; detail?: string };
    const code = body.detail ?? body.error;
    if (code?.startsWith("miyagi_provider_")) return "Miyagi kunne ikke svare lige nu.";
    return code ?? `HTTP ${response.status}`;
  } catch { return `HTTP ${response.status}`; }
}

export default function WellbeingPage() {
  const today = localDate();
  const [date, setDate] = useState(today);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [values, setValues] = useState<Record<string, MetricValue>>({});
  const [savedValues, setSavedValues] = useState<Record<string, MetricValue>>({});
  const [journals, setJournals] = useState<Journal[]>([]);
  const [dayMessages, setDayMessages] = useState<ConversationMessage[]>([]);
  const [journalText, setJournalText] = useState("");
  const [replyText, setReplyText] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [replyBusy, setReplyBusy] = useState<string | null>(null);
  const [checkInOpen, setCheckInOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [miyagiOpen, setMiyagiOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function load(target = date) {
    setLoading(true);
    setMessage(null);
    try {
      const [dayResponse, threadResponse] = await Promise.all([
        fetch(`/api/wellbeing/day?date=${encodeURIComponent(target)}`, { credentials: "same-origin", cache: "no-store" }),
        fetch(`/api/wellbeing/miyagi/checkin-thread?date=${encodeURIComponent(target)}`, { credentials: "same-origin", cache: "no-store" }),
      ]);
      if (!dayResponse.ok) throw new Error(await errorText(dayResponse));
      if (!threadResponse.ok) throw new Error(await errorText(threadResponse));
      const body = await dayResponse.json() as DayResponse;
      const thread = await threadResponse.json() as ThreadResponse;
      const nextValues: Record<string, MetricValue> = Object.fromEntries(body.metrics.map((metric) => [metric.id, null]));
      for (const entry of body.entries) nextValues[entry.metricId] = entry.value;
      setMetrics(body.metrics);
      setValues(nextValues);
      setSavedValues({ ...nextValues });
      setJournals(body.journals);
      setDayMessages(thread.messages ?? []);
      setJournalText("");
      setReplyText({});
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Kunne ikke hente dagens check-in.");
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(date); }, [date]);

  const valuesDirty = useMemo(() => metrics.some((metric) => (values[metric.id] ?? null) !== (savedValues[metric.id] ?? null)), [metrics, values, savedValues]);
  const hasUnsaved = valuesDirty || Boolean(journalText.trim());

  function confirmDiscard(): boolean {
    return !hasUnsaved || window.confirm("Du har ændringer, der ikke er gemt. Vil du kassere dem?");
  }

  function closeCheckIn() {
    if (!confirmDiscard()) return;
    setCheckInOpen(false);
    setJournalText("");
    setValues({ ...savedValues });
    if (date !== today) setDate(today);
  }

  function changeDate(nextDate: string) {
    if (!nextDate || nextDate === date) return;
    if (!confirmDiscard()) return;
    setDate(nextDate);
  }

  useEffect(() => {
    if (!checkInOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") closeCheckIn(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [checkInOpen, date, today, hasUnsaved, savedValues]);

  const completed = useMemo(() => metrics.filter((metric) => values[metric.id] !== null && values[metric.id] !== undefined).length, [metrics, values]);
  const completeToday = date === today && metrics.length > 0 && completed === metrics.length;
  const hasTodayData = date === today && completed > 0;
  const todayJournal = date === today ? journals[0] ?? null : null;

  function setMetricValue(metricId: string, next: number) {
    setValues((current) => ({ ...current, [metricId]: current[metricId] === next ? null : next }));
  }

  async function saveAll() {
    setSaving(true); setMessage(null);
    try {
      const dayResponse = await fetch("/api/wellbeing/day", {
        method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, values }),
      });
      if (!dayResponse.ok) throw new Error(await errorText(dayResponse));
      setSavedValues({ ...values });

      const text = journalText.trim();
      if (text) {
        const journalResponse = await fetch("/api/wellbeing/journal", {
          method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date, body: text }),
        });
        if (!journalResponse.ok) throw new Error(await errorText(journalResponse));
        const body = await journalResponse.json() as { journal: Journal };
        const journal = body.journal;
        setJournals((current) => [journal, ...current]);
        setJournalText("");

        try {
          const miyagiResponse = await fetch("/api/wellbeing/miyagi/checkin", {
            method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ journalId: journal.id }),
          });
          if (!miyagiResponse.ok) throw new Error(await errorText(miyagiResponse));
          const miyagiBody = await miyagiResponse.json() as { messages: ConversationMessage[] };
          setDayMessages((current) => mergeMessages(current, miyagiBody.messages ?? []));
          setMessage("Check-in, kommentar og Miyagi-svar er gemt på dagen.");
        } catch (error) {
          setMessage(`Check-in og kommentar er gemt, men ${error instanceof Error ? error.message : "Miyagi kunne ikke svare."}`);
        }
      } else {
        setMessage("Check-in er gemt.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Check-in kunne ikke gemmes.");
    } finally { setSaving(false); }
  }

  async function sendThreadReply(journalId: string) {
    const text = (replyText[journalId] ?? "").trim();
    if (!text || replyBusy) return;
    setReplyBusy(journalId);
    setMessage(null);
    try {
      const response = await fetch("/api/wellbeing/miyagi/checkin-thread", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ journalId, message: text }),
      });
      if (!response.ok) throw new Error(await errorText(response));
      const body = await response.json() as { messages: ConversationMessage[] };
      setDayMessages((current) => mergeMessages(current, body.messages ?? []));
      setReplyText((current) => ({ ...current, [journalId]: "" }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Miyagi kunne ikke svare lige nu.");
    } finally { setReplyBusy(null); }
  }

  async function removeJournal(id: string) {
    if (!window.confirm("Slet dette journalnotat og den tilhørende Miyagi-tråd?")) return;
    const response = await fetch(`/api/wellbeing/journal/${id}`, { method: "DELETE", credentials: "same-origin" });
    if (response.ok) {
      setJournals((current) => current.filter((item) => item.id !== id));
      setDayMessages((current) => current.filter((item) => item.journalEntryId !== id));
    }
  }

  const checkInStatus = loading
    ? "Henter status…"
    : metrics.length === 0 ? "Ingen aktive målepunkter"
      : completeToday ? "Færdig for i dag"
        : hasTodayData ? `${completed} af ${metrics.length} udfyldt` : "Ikke udført i dag";

  return <section className="wellbeing-page">
    <div className="wellbeing-command-list">
      <article className="wellbeing-command-row">
        <div className={`wellbeing-command-icon ${completeToday ? "is-complete" : ""}`} aria-hidden="true">{completeToday ? "✓" : "☀"}</div>
        <div className="wellbeing-command-copy"><strong>Dagligt check-in</strong><span>{checkInStatus}</span></div>
        <span className={`wellbeing-status-pill ${completeToday ? "complete" : "pending"}`}>{completeToday ? "Udført" : "I dag"}</span>
        <div className="wellbeing-command-actions">
          <button className="secondary-action" type="button" onClick={() => setHistoryOpen(true)}>Historik</button>
          <button className="secondary-action wellbeing-command-action" type="button" onClick={() => { setDate(today); setCheckInOpen(true); }}>
            {completeToday ? "Se / ret" : "Udfør check-in"}
          </button>
        </div>
      </article>

      <article className={`wellbeing-command-row wellbeing-miyagi-row ${miyagiOpen ? "open" : ""}`}>
        <div className="wellbeing-command-icon miyagi" aria-hidden="true">盆</div>
        <div className="wellbeing-command-copy"><strong>Mr. Miyagi</strong><span>Krydsrefererer sundhed, motion, journal og dine egne målepunkter.</span></div>
        <span className="wellbeing-status-pill neutral">Analyse</span>
        <button className="secondary-action wellbeing-command-action" type="button" onClick={() => setMiyagiOpen((current) => !current)} aria-expanded={miyagiOpen}>
          {miyagiOpen ? "Luk" : "Åbn Miyagi"}
        </button>
      </article>
    </div>

    {!loading && date === today && (hasTodayData || todayJournal) && <section className="wellbeing-today-summary" aria-label="Dagens velbefindende">
      <div className="wellbeing-today-heading"><div><p className="section-label">I dag</p><h2>Dagens status</h2></div><button className="secondary-action" type="button" onClick={() => setCheckInOpen(true)}>Rediger</button></div>
      {hasTodayData && <div className="wellbeing-today-metrics">{metrics.filter((metric) => values[metric.id] !== null && values[metric.id] !== undefined).map((metric) => <div key={metric.id}><span>{metric.emoji} {metric.name}</span><strong>{metricValueLabel(metric, values[metric.id])}</strong></div>)}</div>}
      <div className="wellbeing-today-journal"><span>Kommentar</span>{todayJournal ? <p>{todayJournal.body}</p> : <p className="is-empty">Ingen kommentar i dag.</p>}</div>
    </section>}

    <MiyagiWorkspace expanded={miyagiOpen} />
    {historyOpen && <WellbeingHistory onClose={() => setHistoryOpen(false)} />}

    {checkInOpen && <div className="wellbeing-checkin-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeCheckIn(); }}>
      <section className="wellbeing-checkin-dialog" role="dialog" aria-modal="true" aria-labelledby="wellbeing-checkin-title">
        <header className="wellbeing-checkin-dialog-heading">
          <div><p className="section-label">Dagligt check-in</p><h2 id="wellbeing-checkin-title">{displayDate(date)}</h2><p>{metrics.length ? `${completed} af ${metrics.length} målepunkter udfyldt` : "Opret dine målepunkter under Indstillinger."}</p></div>
          <button className="icon-action" type="button" onClick={closeCheckIn} aria-label="Luk check-in">×</button>
        </header>

        <div className="wellbeing-checkin-toolbar">
          <label><span>Dato</span><input type="date" value={date} onChange={(event) => changeDate(event.target.value)} /></label>
          {date !== today && <button className="secondary-action" type="button" onClick={() => changeDate(today)}>Gå til i dag</button>}
        </div>

        {loading ? <p className="empty-state">Henter check-in…</p> : metrics.length === 0 ? <section className="wellbeing-empty"><strong>Ingen målepunkter endnu</strong><p>Gå til Indstillinger → Velbefindende og opret de ting du vil følge dagligt.</p></section> : <section className="wellbeing-checkin">
          {metrics.map((metric) => {
            const currentValue = values[metric.id] ?? null;
            if (metric.valueType === "boolean") {
              return <article className="wellbeing-metric" key={metric.id}>
                <div className="wellbeing-metric-name"><span>{metric.emoji}</span><strong>{metric.name}</strong></div>
                <div className="wellbeing-boolean-row" role="radiogroup" aria-label={metric.name}>
                  <button type="button" className={currentValue === 0 ? "active" : ""} onClick={() => setMetricValue(metric.id, 0)} aria-pressed={currentValue === 0}>Nej</button>
                  <button type="button" className={currentValue === 1 ? "active" : ""} onClick={() => setMetricValue(metric.id, 1)} aria-pressed={currentValue === 1}>Ja</button>
                  {currentValue !== null && <button className="wellbeing-clear-value" type="button" onClick={() => setValues((current) => ({ ...current, [metric.id]: null }))}>Ryd</button>}
                </div>
              </article>;
            }
            const faces = metric.direction === "high_bad" ? badFaces : goodFaces;
            return <article className="wellbeing-metric" key={metric.id}>
              <div className="wellbeing-metric-name"><span>{metric.emoji}</span><strong>{metric.name}</strong></div>
              <div className="wellbeing-score-row" role="radiogroup" aria-label={metric.name}>
                {faces.map((face, index) => {
                  const value = index + 1;
                  return <button key={value} type="button" className={currentValue === value ? "active" : ""} onClick={() => setMetricValue(metric.id, value)} aria-label={`${metric.name}: ${value} af 5`} aria-pressed={currentValue === value}><span>{face}</span><small>{value}</small></button>;
                })}
              </div>
              {currentValue !== null && <button className="wellbeing-clear-value" type="button" onClick={() => setValues((current) => ({ ...current, [metric.id]: null }))}>Ryd værdi</button>}
            </article>;
          })}
        </section>}

        <section className="wellbeing-journal wellbeing-journal-inline">
          <div><p className="section-label">Kommentar og Miyagi</p><h3>Dagstråd</h3><p>Alt her hører til {displayDate(date)}, også hvis du skriver svaret på et senere tidspunkt.</p></div>
          <textarea value={journalText} onChange={(event) => setJournalText(event.target.value)} rows={4} maxLength={20_000} placeholder="Hvad fyldte denne dag? Hvad gik godt eller skidt?" />

          {journals.length > 0 && <div className="wellbeing-journal-list">{journals.map((journal) => {
            const thread = dayMessages.filter((item) => item.journalEntryId === journal.id && !(item.role === "user" && item.body === journal.body));
            return <article key={journal.id}>
              <strong>Dig</strong><p>{journal.body}</p>
              <div><small>{displayTimestamp(journal.createdAt)}</small><button type="button" onClick={() => void removeJournal(journal.id)}>Slet</button></div>
              {thread.map((item) => <section className={`miyagi-message ${item.role}`} key={item.id}>
                <strong>{item.role === "assistant" ? "Miyagi" : "Dig"}</strong>
                <MiyagiMarkdown text={item.body} />
                <small>{displayTimestamp(item.createdAt)}</small>
              </section>)}
              <form className="miyagi-chat-compose" onSubmit={(event) => { event.preventDefault(); void sendThreadReply(journal.id); }}>
                <textarea rows={2} maxLength={4000} value={replyText[journal.id] ?? ""} onChange={(event) => setReplyText((current) => ({ ...current, [journal.id]: event.target.value }))} placeholder="Svar Miyagi i denne dags tråd…" disabled={replyBusy === journal.id} />
                <div className="miyagi-chat-compose-actions"><small>Gemmes på {displayDate(date)}</small><button type="submit" disabled={replyBusy === journal.id || !(replyText[journal.id] ?? "").trim()}>{replyBusy === journal.id ? "…" : "Send"}</button></div>
              </form>
            </article>;
          })}</div>}
        </section>

        <div className="wellbeing-dialog-actions">
          <button className="secondary-action" type="button" onClick={closeCheckIn}>Luk</button>
          <button className="primary-action" type="button" disabled={saving || !hasUnsaved} onClick={() => void saveAll()}>{saving ? "Gemmer…" : "Gem"}</button>
        </div>

        {message && <p className={`settings-feedback ${message.includes("gemt") ? "success" : "error"}`}>{message}</p>}
      </section>
    </div>}

    {!checkInOpen && message && <p className={`settings-feedback ${message.includes("gemt") ? "success" : "error"}`}>{message}</p>}
  </section>;
}
