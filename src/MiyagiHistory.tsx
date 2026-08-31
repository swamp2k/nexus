import { useEffect, useState } from "react";
import MiyagiMarkdown from "./MiyagiMarkdown";

type HistoryAnalysis = {
  id: string;
  periodDays: number;
  periodStart: string;
  periodEnd: string;
  analysis: string;
  createdAt: string;
  focus: string | null;
  responseLength: "short" | "normal" | "deep" | null;
  tone: "objective" | "empathetic" | "miyagi" | null;
  messageCount: number;
};

type Message = { id: string; role: "user" | "assistant"; body: string; createdAt: string };

type DetailResponse = { analysis: HistoryAnalysis; messages: Message[] };

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("da-DK", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function formatDate(value: string): string {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function lengthLabel(value: HistoryAnalysis["responseLength"]): string {
  return value === "deep" ? "Grundig" : value === "normal" ? "Normal" : "Kort";
}

function toneLabel(value: HistoryAnalysis["tone"]): string {
  return value === "objective" ? "Objektiv" : value === "miyagi" ? "Mr. Miyagi" : "Empatisk";
}

export default function MiyagiHistory({ onClose }: { onClose: () => void }) {
  const [analyses, setAnalyses] = useState<HistoryAnalysis[]>([]);
  const [selected, setSelected] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailBusy, setDetailBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/wellbeing/miyagi/history?limit=50", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<{ analyses: HistoryAnalysis[] }>;
      })
      .then((body) => { if (!cancelled) setAnalyses(body.analyses ?? []); })
      .catch((caught: Error) => { if (!cancelled) setError(caught.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function openAnalysis(id: string) {
    setDetailBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/wellbeing/miyagi/history/${id}`, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setSelected(await response.json() as DetailResponse);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Kunne ikke hente analysen.");
    } finally {
      setDetailBusy(false);
    }
  }

  return <div className="miyagi-history-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="miyagi-history-dialog" role="dialog" aria-modal="true" aria-labelledby="miyagi-history-title">
      <header className="miyagi-history-heading">
        <div><p className="section-label">Mr. Miyagi</p><h2 id="miyagi-history-title">Historik</h2><p>Tidligere analyser og de samtaler der hører til dem.</p></div>
        <button className="icon-action" type="button" onClick={onClose} aria-label="Luk historik">×</button>
      </header>

      <div className="miyagi-history-layout">
        <aside className="miyagi-history-list">
          {loading && <p className="empty-state">Henter analyser…</p>}
          {!loading && analyses.length === 0 && <p className="empty-state">Ingen analyser endnu.</p>}
          {analyses.map((item) => <button type="button" className={selected?.analysis.id === item.id ? "active" : ""} key={item.id} onClick={() => void openAnalysis(item.id)}>
            <strong>{formatTimestamp(item.createdAt)}</strong>
            <span>{formatDate(item.periodStart)} – {formatDate(item.periodEnd)}</span>
            <small>{lengthLabel(item.responseLength)} · {toneLabel(item.tone)}{Number(item.messageCount) ? ` · ${item.messageCount} chatbeskeder` : ""}</small>
            {item.focus && <em>{item.focus}</em>}
          </button>)}
        </aside>

        <div className="miyagi-history-detail">
          {detailBusy && <p className="empty-state">Henter analyse…</p>}
          {!selected && !detailBusy && <p className="empty-state">Vælg en analyse i listen.</p>}
          {selected && !detailBusy && <>
            <div className="miyagi-history-detail-meta">
              <strong>{lengthLabel(selected.analysis.responseLength)} · {toneLabel(selected.analysis.tone)}</strong>
              {selected.analysis.focus && <span>Fokus: {selected.analysis.focus}</span>}
            </div>
            <MiyagiMarkdown text={selected.analysis.analysis} />
            {selected.messages.length > 0 && <section className="miyagi-history-chat">
              <h3>Samtale</h3>
              {selected.messages.map((message) => <article className={`miyagi-message ${message.role}`} key={message.id}>
                <strong>{message.role === "assistant" ? "Miyagi" : "Dig"}</strong>
                <MiyagiMarkdown text={message.body} />
              </article>)}
            </section>}
          </>}
        </div>
      </div>
      {error && <p className="settings-feedback error">{error}</p>}
    </section>
  </div>;
}
