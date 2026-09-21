import { useEffect, useMemo, useState } from "react";

type Subject = {
  id: string;
  name: string;
  kind: "self" | "person";
  isDefault: number;
  allowMultipleCheckins: number;
  garminEnabled: number;
};

type Metric = {
  id: string;
  name: string;
  emoji: string;
  direction: "high_good" | "high_bad";
  valueType: "scale" | "boolean";
};

type SubjectCheckin = {
  id: string;
  entryDate: string;
  occurredAt: string;
  values: Array<{ metricId: string; value: number }>;
  journals: Array<{ id: string; body: string; createdAt: string }>;
};

type DayResponse = { subject: Subject; date: string; metrics: Metric[]; checkins: SubjectCheckin[] };
type Reminder = { subjectId: string; enabled: number; hourLocal: number; subjectName: string };

function localDate(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function errorText(response: Response): Promise<string> {
  return response.json().then((body: { error?: string; detail?: string }) => body.detail ?? body.error ?? `HTTP ${response.status}`).catch(() => `HTTP ${response.status}`);
}

function face(metric: Metric, value: number): string {
  const good = ["😫", "😕", "😐", "🙂", "😁"];
  const list = metric.direction === "high_bad" ? [...good].reverse() : good;
  return list[Math.max(0, Math.min(4, value - 1))];
}

export default function SubjectCheckinPanel() {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [day, setDay] = useState<DayResponse | null>(null);
  const [values, setValues] = useState<Record<string, number | null>>({});
  const [comment, setComment] = useState("");
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [miyagiReply, setMiyagiReply] = useState<string | null>(null);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [discordConfigured, setDiscordConfigured] = useState(false);
  const [reminderHour, setReminderHour] = useState(20);
  const [reminderEnabled, setReminderEnabled] = useState(false);

  const selected = subjects.find((subject) => subject.id === selectedId) ?? subjects.find((subject) => Boolean(subject.isDefault)) ?? null;
  const isSelf = Boolean(selected?.isDefault);
  const today = localDate();

  async function loadSubjects() {
    const response = await fetch("/api/wellbeing/subjects", { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) throw new Error(await errorText(response));
    const body = await response.json() as { subjects: Subject[] };
    setSubjects(body.subjects);
    const querySubject = new URLSearchParams(window.location.search).get("subject");
    const preferred = body.subjects.find((subject) => subject.id === querySubject)
      ?? body.subjects.find((subject) => Boolean(subject.isDefault))
      ?? body.subjects[0];
    if (preferred) setSelectedId((current) => current || preferred.id);
  }

  async function loadReminder(subjectId: string) {
    const response = await fetch("/api/wellbeing/reminder", { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) return;
    const body = await response.json() as { reminders: Reminder[]; discordConfigured: boolean };
    setReminders(body.reminders);
    setDiscordConfigured(body.discordConfigured);
    const current = body.reminders.find((item) => item.subjectId === subjectId);
    setReminderHour(current?.hourLocal ?? 20);
    setReminderEnabled(Boolean(current?.enabled));
  }

  async function loadDay(subjectId: string) {
    const response = await fetch(`/api/wellbeing/subject-day?subjectId=${encodeURIComponent(subjectId)}&date=${today}`, {
      credentials: "same-origin", cache: "no-store",
    });
    if (!response.ok) throw new Error(await errorText(response));
    const body = await response.json() as DayResponse;
    setDay(body);
    setValues(Object.fromEntries(body.metrics.map((metric) => [metric.id, null])));
    setComment("");
    setMiyagiReply(null);
  }

  useEffect(() => { void loadSubjects().catch((error: Error) => setMessage(error.message)); }, []);
  useEffect(() => {
    if (!selectedId) return;
    void loadReminder(selectedId);
    if (!subjects.find((subject) => subject.id === selectedId)?.isDefault) {
      void loadDay(selectedId).catch((error: Error) => setMessage(error.message));
    } else {
      setDay(null);
    }
  }, [selectedId, subjects.length]);

  const completed = useMemo(() => day?.metrics.filter((metric) => values[metric.id] !== null && values[metric.id] !== undefined).length ?? 0, [day, values]);

  async function createSubject() {
    const name = newName.trim();
    if (!name) return;
    setSaving(true); setMessage(null);
    try {
      const response = await fetch("/api/wellbeing/subjects", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, allowMultipleCheckins: true }),
      });
      if (!response.ok) throw new Error(await errorText(response));
      const body = await response.json() as { subject: Subject };
      setNewName(""); setAdding(false);
      await loadSubjects();
      setSelectedId(body.subject.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Personen kunne ikke oprettes.");
    } finally { setSaving(false); }
  }

  async function saveCheckin() {
    if (!selected || isSelf || !day) return;
    setSaving(true); setMessage(null); setMiyagiReply(null);
    try {
      const response = await fetch("/api/wellbeing/checkins", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subjectId: selected.id, occurredAt: new Date().toISOString(), values, comment }),
      });
      if (!response.ok) throw new Error(await errorText(response));
      const body = await response.json() as { checkin: { journalId: string | null } };
      if (body.checkin.journalId) {
        const miyagi = await fetch("/api/wellbeing/miyagi/checkin", {
          method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ journalId: body.checkin.journalId }),
        });
        if (miyagi.ok) {
          const miyagiBody = await miyagi.json() as { messages: Array<{ role: string; body: string }> };
          const reply = [...miyagiBody.messages].reverse().find((item) => item.role === "assistant");
          setMiyagiReply(reply?.body ?? null);
        }
      }
      await loadDay(selected.id);
      setMessage(`Check-in for ${selected.name} er gemt.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Check-in kunne ikke gemmes.");
    } finally { setSaving(false); }
  }

  async function saveReminder() {
    if (!selected) return;
    setSaving(true); setMessage(null);
    try {
      const response = await fetch("/api/wellbeing/reminder", {
        method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subjectId: selected.id, enabled: reminderEnabled, hourLocal: reminderHour }),
      });
      if (!response.ok) throw new Error(await errorText(response));
      await loadReminder(selected.id);
      setMessage(reminderEnabled ? "Påmindelsen er gemt." : "Påmindelsen er slået fra.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Påmindelsen kunne ikke gemmes.");
    } finally { setSaving(false); }
  }

  return <section className="wellbeing-subject-shell">
    <div className="wellbeing-subject-bar">
      <div>
        <p className="section-label">Profil</p>
        <div className="wellbeing-subject-tabs">
          {subjects.map((subject) => <button key={subject.id} type="button"
            className={subject.id === selected?.id ? "active" : ""}
            onClick={() => setSelectedId(subject.id)}>{subject.name}</button>)}
          <button type="button" className="wellbeing-subject-add" onClick={() => setAdding((value) => !value)}>＋ Person</button>
        </div>
      </div>
      {selected && <small>{selected.garminEnabled ? "Garmin tilkoblet" : "Uden Garmin"}{selected.allowMultipleCheckins ? " · flere check-ins pr. dag" : ""}</small>}
    </div>

    {adding && <div className="wellbeing-subject-create">
      <input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Navn, fx Balder" maxLength={80} />
      <button className="primary-action" type="button" disabled={saving || !newName.trim()} onClick={() => void createSubject()}>Opret</button>
      <button className="secondary-action" type="button" onClick={() => setAdding(false)}>Annuller</button>
    </div>}

    {!isSelf && selected && day && <div className="wellbeing-subject-content">
      <div className="wellbeing-subject-summary">
        <strong>{selected.name} · i dag</strong>
        <span>{day.checkins.length} check-in{day.checkins.length === 1 ? "" : "s"} registreret</span>
      </div>

      {day.checkins.length > 0 && <div className="wellbeing-subject-timeline">
        {day.checkins.map((checkin) => <article key={checkin.id}>
          <strong>{new Intl.DateTimeFormat("da-DK", { hour: "2-digit", minute: "2-digit" }).format(new Date(checkin.occurredAt))}</strong>
          <span>{checkin.values.length} målepunkter</span>
          {checkin.journals[0]?.body && <p>{checkin.journals[0].body}</p>}
        </article>)}
      </div>}

      <div className="wellbeing-subject-form">
        <div className="wellbeing-subject-metrics">
          {day.metrics.map((metric) => <div key={metric.id} className="wellbeing-subject-metric">
            <span className="wellbeing-subject-metric-name">{metric.emoji} {metric.name}</span>
            {metric.valueType === "boolean"
              ? <div className="wellbeing-subject-scale">
                  {[0, 1].map((value) => <button key={value} type="button" className={values[metric.id] === value ? "selected" : ""}
                    onClick={() => setValues((current) => ({ ...current, [metric.id]: current[metric.id] === value ? null : value }))}>{value === 1 ? "Ja" : "Nej"}</button>)}
                </div>
              : <div className="wellbeing-subject-scale">
                  {[1, 2, 3, 4, 5].map((value) => <button key={value} type="button" title={String(value)}
                    className={values[metric.id] === value ? "selected" : ""}
                    onClick={() => setValues((current) => ({ ...current, [metric.id]: current[metric.id] === value ? null : value }))}>{face(metric, value)}</button>)}
                </div>}
          </div>)}
        </div>
        <textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={3}
          placeholder={`Kommentar om ${selected.name} lige nu (valgfri)`} />
        <div className="wellbeing-subject-save-row">
          <span>{completed} af {day.metrics.length} udfyldt</span>
          <button className="primary-action" type="button" disabled={saving || completed === 0} onClick={() => void saveCheckin()}>
            {saving ? "Gemmer…" : "Gem check-in nu"}
          </button>
        </div>
        {miyagiReply && <div className="wellbeing-subject-miyagi"><strong>Miyagi</strong><p>{miyagiReply}</p></div>}
      </div>
    </div>}

    {selected && <details className="wellbeing-reminder-settings">
      <summary>Check-in påmindelse</summary>
      <div>
        <label><input type="checkbox" checked={reminderEnabled} onChange={(event) => setReminderEnabled(event.target.checked)} /> Aktiv</label>
        <label>Tid <input type="number" min={0} max={23} value={reminderHour} onChange={(event) => setReminderHour(Number(event.target.value))} />:00</label>
        <button className="secondary-action" type="button" disabled={saving} onClick={() => void saveReminder()}>Gem</button>
        <small>{discordConfigured ? "Leveres via Discord med direkte link til Nexus check-in." : "Discord webhook mangler på Worker; reminder-reglen kan gemmes, men kan ikke leveres endnu."}</small>
      </div>
    </details>}

    {message && <p className="settings-feedback">{message}</p>}
  </section>;
}
