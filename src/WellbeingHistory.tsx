import { useEffect, useState } from "react";

type MetricEntry = {
  metricId: string;
  name: string;
  emoji: string;
  direction: "high_good" | "high_bad";
  valueType: "scale" | "boolean";
  value: number;
};

type Journal = {
  id: string;
  body: string;
  createdAt: string;
};

type HistoryDay = {
  date: string;
  metrics: MetricEntry[];
  journals: Journal[];
};

function isMetricEntry(value: unknown): value is MetricEntry {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.metricId === "string"
    && typeof row.name === "string"
    && typeof row.emoji === "string"
    && (row.direction === "high_good" || row.direction === "high_bad")
    && (row.valueType === "scale" || row.valueType === "boolean")
    && typeof row.value === "number";
}

function isJournal(value: unknown): value is Journal {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string"
    && typeof row.body === "string"
    && typeof row.createdAt === "string";
}

function parseHistoryDays(value: unknown): HistoryDay[] {
  if (!value || typeof value !== "object") throw new Error("Ugyldigt historik-svar.");
  const body = value as Record<string, unknown>;
  if (!Array.isArray(body.days)) throw new Error("Ugyldigt historik-svar.");

  return body.days.map((item) => {
    if (!item || typeof item !== "object") throw new Error("Ugyldig historik-række.");
    const row = item as Record<string, unknown>;
    if (typeof row.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) {
      throw new Error("Historikken indeholder en ugyldig dato.");
    }
    if (!Array.isArray(row.metrics) || !Array.isArray(row.journals)) {
      throw new Error("Historikken mangler målepunkter eller kommentarer.");
    }
    return {
      date: row.date,
      metrics: row.metrics.filter(isMetricEntry),
      journals: row.journals.filter(isJournal),
    };
  });
}

function formatDate(value: string): string {
  const date = new Date(`${value}T12:00:00`);
  return new Intl.DateTimeFormat("da-DK", { weekday: "short", day: "numeric", month: "long", year: "numeric" }).format(date);
}

function faceFor(metric: MetricEntry): string {
  const good = ["😫", "😕", "😐", "🙂", "😁"];
  const bad = [...good].reverse();
  return (metric.direction === "high_bad" ? bad : good)[Math.max(0, Math.min(4, metric.value - 1))];
}

function metricValue(metric: MetricEntry): string {
  if (metric.valueType === "boolean") return metric.value === 1 ? "Ja" : "Nej";
  return `${faceFor(metric)} ${metric.value}/5`;
}

export default function WellbeingHistory({ onClose }: { onClose: () => void }) {
  const [days, setDays] = useState<HistoryDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openDays, setOpenDays] = useState<Set<string>>(new Set());

  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/wellbeing/history?limit=180", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<unknown>;
      })
      .then((body) => { if (!cancelled) setDays(parseHistoryDays(body)); })
      .catch((caught: Error) => { if (!cancelled) setError(caught.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  function toggle(date: string) {
    setOpenDays((current) => {
      const next = new Set(current);
      if (next.has(date)) next.delete(date); else next.add(date);
      return next;
    });
  }

  return <div className="wellbeing-history-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="wellbeing-history-dialog" role="dialog" aria-modal="true" aria-labelledby="wellbeing-history-title">
      <header className="wellbeing-history-heading">
        <div><p className="section-label">Dagligt check-in</p><h2 id="wellbeing-history-title">Historik</h2><p>Målepunkter og kommentarer pr. dag. Miyagi-samtalen fortsætter samlet i chatten.</p></div>
        <button className="icon-action" type="button" onClick={onClose} aria-label="Luk historik">×</button>
      </header>

      {loading && <p className="empty-state">Henter historik…</p>}
      {error && <p className="settings-feedback error">Kunne ikke hente historikken: {error}</p>}
      {!loading && !error && days.length === 0 && <p className="empty-state">Ingen check-ins eller journalnoter endnu.</p>}

      <div className="wellbeing-history-list">
        {days.map((day) => {
          const open = openDays.has(day.date);
          return <article className={`wellbeing-history-day ${open ? "open" : ""}`} key={day.date}>
            <div
              className="wellbeing-history-day-toggle"
              role="button"
              tabIndex={0}
              onClick={() => toggle(day.date)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  toggle(day.date);
                }
              }}
              aria-expanded={open}
            >
              <span className="wellbeing-history-chevron">›</span>
              <strong>{formatDate(day.date)}</strong>
              <span>{day.metrics.length ? `${day.metrics.length} målepunkter` : "Ingen målepunkter"}</span>
              {day.journals.length > 0 && <span>{day.journals.length} kommentar{day.journals.length === 1 ? "" : "er"}</span>}
            </div>

            {open && <div className="wellbeing-history-day-body">
              {day.metrics.length > 0 && <div className="wellbeing-history-metrics">
                {day.metrics.map((metric) => <div key={metric.metricId}><span>{metric.emoji}</span><strong>{metric.name}</strong><span>{metricValue(metric)}</span></div>)}
              </div>}

              {day.journals.map((journal) => <section className="wellbeing-history-journal" key={journal.id}>
                <p>{journal.body}</p>
              </section>)}
            </div>}
          </article>;
        })}
      </div>
    </section>
  </div>;
}
