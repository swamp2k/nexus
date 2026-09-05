import { useEffect, useState } from "react";
import MiyagiHistory from "./MiyagiHistory";
import MiyagiMarkdown from "./MiyagiMarkdown";

type Analysis = {
  id: string;
  periodDays: number;
  periodStart: string;
  periodEnd: string;
  model: string;
  contextHash: string;
  analysis: string;
  createdAt: string;
  focus?: string | null;
  responseLength?: "short" | "normal" | "deep" | null;
  tone?: "objective" | "empathetic" | "miyagi" | null;
  coverage?: {
    healthDays: number;
    sleepDays: number;
    activityCount: number;
    checkInValues: number;
    journalEntries: number;
  };
};

type Message = {
  id?: string;
  role: "user" | "assistant";
  body: string;
  createdAt: string;
};

type LatestResponse = { analysis: Analysis | null; messages: Message[] };
type AnalysisLength = "short" | "normal" | "deep";
type AnalysisTone = "objective" | "empathetic" | "miyagi";

async function errorText(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: string; detail?: string };
    const code = body.detail ?? body.error;
    if (code === "miyagi_not_configured") return "Miyagi mangler model-konfiguration endnu.";
    if (code === "miyagi_no_data") return "Der er endnu ikke nok Nexus-data til en analyse.";
    if (code?.startsWith("miyagi_provider_")) return "Miyagi kunne ikke få svar fra analysemodellen. Prøv igen om lidt.";
    return code ?? `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

function formatDate(value: string): string {
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "short", year: "numeric" }).format(parsed);
}

function formatTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("da-DK", { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

export default function MiyagiWorkspace() {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "analyzing" | "error">("loading");
  const [chatText, setChatText] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysisDialogOpen, setAnalysisDialogOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [focus, setFocus] = useState("");
  const [analysisDays, setAnalysisDays] = useState<30 | 60 | 90 | 180>(90);
  const [analysisLength, setAnalysisLength] = useState<AnalysisLength>("short");
  const [analysisTone, setAnalysisTone] = useState<AnalysisTone>("empathetic");

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/wellbeing/miyagi/latest", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(await errorText(response));
        return response.json() as Promise<LatestResponse>;
      })
      .then((body) => {
        if (cancelled) return;
        setAnalysis(body.analysis);
        setMessages(body.messages ?? []);
        setState("ready");
      })
      .catch((caught: Error) => {
        if (cancelled) return;
        setError(caught.message);
        setState("error");
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!analysisDialogOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setAnalysisDialogOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [analysisDialogOpen]);

  function openAnalysisDialog() {
    setFocus("");
    setAnalysisDays(90);
    setAnalysisLength("short");
    setAnalysisTone("empathetic");
    setAnalysisDialogOpen(true);
  }

  async function runAnalysis() {
    setAnalysisDialogOpen(false);
    setState("analyzing");
    setError(null);
    try {
      const response = await fetch("/api/wellbeing/miyagi/analyze", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          days: analysisDays,
          focus: focus.trim(),
          length: analysisLength,
          tone: analysisTone,
        }),
      });
      if (!response.ok) throw new Error(await errorText(response));
      const body = await response.json() as LatestResponse;
      setAnalysis(body.analysis);
      setMessages(body.messages ?? []);
      setState("ready");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Miyagi kunne ikke gennemføre analysen.");
      setState("error");
    }
  }

  async function sendMessage() {
    if (!analysis || !chatText.trim() || chatBusy) return;
    const text = chatText.trim();
    setChatBusy(true);
    setError(null);
    setChatText("");
    try {
      const response = await fetch("/api/wellbeing/miyagi/chat", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysisId: analysis.id, message: text }),
      });
      if (!response.ok) throw new Error(await errorText(response));
      const body = await response.json() as { messages: Message[] };
      setMessages((current) => [...current, ...body.messages]);
    } catch (caught) {
      setChatText(text);
      setError(caught instanceof Error ? caught.message : "Miyagi kunne ikke svare lige nu.");
    } finally {
      setChatBusy(false);
    }
  }

  return <section className="miyagi-workspace" aria-label="Mr. Miyagi analyse">
    <div className="miyagi-workspace-actions">
      <button className="secondary-action" type="button" onClick={() => setHistoryOpen(true)}>Historik</button>
      <button className="primary-action" type="button" disabled={state === "loading" || state === "analyzing"} onClick={openAnalysisDialog}>
        {state === "analyzing" ? "Miyagi tænker…" : analysis ? "Analysér igen" : "Start analyse"}
      </button>
    </div>

    {state === "loading" && <div className="miyagi-empty-analysis"><strong>Finder den seneste analyse…</strong></div>}
    {state === "analyzing" && <div className="miyagi-thinking"><span className="miyagi-thinking-dot" /><div><strong>Miyagi lægger dagene ved siden af hinanden…</strong><p>Han leder efter samtidige ændringer, før/efter-forløb og ting der er værd at spørge dig om.</p></div></div>}

    {analysis && state !== "analyzing" && <section className="miyagi-analysis-card">
      <header className="miyagi-analysis-meta">
        <div><strong>Analyse</strong><span>{formatDate(analysis.periodStart)} – {formatDate(analysis.periodEnd)}</span></div>
        <small>{formatTimestamp(analysis.createdAt)}</small>
      </header>
      <MiyagiMarkdown text={analysis.analysis} />
      {analysis.coverage && <div className="miyagi-coverage">
        <span>{analysis.coverage.healthDays} sundhedsdage</span>
        <span>{analysis.coverage.sleepDays} nætter</span>
        <span>{analysis.coverage.activityCount} aktiviteter</span>
        <span>{analysis.coverage.checkInValues} check-in værdier</span>
        <span>{analysis.coverage.journalEntries} journalnoter</span>
      </div>}
    </section>}

    {!analysis && state === "ready" && <div className="miyagi-empty-analysis">
      <strong>Ingen analyse endnu</strong>
      <p>Start en analyse. Standard er kort og empatisk; du kan vælge fokus eller en anden svarstil i dialogen.</p>
    </div>}

    {analysis && <section className="miyagi-conversation">
      <div className="miyagi-conversation-heading"><strong>Tal med Miyagi</strong><span>Svar på hans spørgsmål, spørg ind til et fund eller giv ham kontekst han ikke kunne se i data.</span></div>
      {messages.length > 0 && <div className="miyagi-messages">{messages.map((message, index) => <article className={`miyagi-message ${message.role}`} key={message.id ?? `${message.createdAt}-${index}`}>
        <strong>{message.role === "assistant" ? "Miyagi" : "Dig"}</strong>
        <MiyagiMarkdown text={message.body} />
      </article>)}</div>}
      <form className="miyagi-chat-shell" onSubmit={(event) => { event.preventDefault(); void sendMessage(); }}>
        <input value={chatText} onChange={(event) => setChatText(event.target.value)} disabled={chatBusy} maxLength={4000} placeholder="Fx: Ja, i juli var vi på ferie og jeg sov et andet sted…" aria-label="Spørg Mr. Miyagi" />
        <button type="submit" disabled={chatBusy || !chatText.trim()}>{chatBusy ? "…" : "Send"}</button>
      </form>
    </section>}

    {error && <p className="settings-feedback error">{error}</p>}
    <small className="miyagi-disclaimer">Miyagi er et analyseværktøj i et privat hobbyprojekt. Han kan hjælpe med mønstre og refleksion, men er ikke læge og erstatter ikke faglig vurdering.</small>

    {analysisDialogOpen && <div className="miyagi-analysis-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAnalysisDialogOpen(false); }}>
      <section className="miyagi-analysis-dialog" role="dialog" aria-modal="true" aria-labelledby="miyagi-analysis-title">
        <header>
          <div><p className="section-label">Ny analyse</p><h3 id="miyagi-analysis-title">Hvad skal Miyagi kigge efter?</h3></div>
          <button className="icon-action" type="button" onClick={() => setAnalysisDialogOpen(false)} aria-label="Luk">×</button>
        </header>

        <label className="miyagi-focus-field">
          <span>Fokus <small>valgfrit</small></span>
          <textarea rows={3} maxLength={1200} value={focus} onChange={(event) => setFocus(event.target.value)} placeholder="Tomt felt = generel analyse. Eller fx: Kig især på søvn, energi og perioder med høj hvilepuls." />
        </label>

        <fieldset className="miyagi-option-group miyagi-period-group">
          <legend>Periode</legend>
          <div>
            {([30, 60, 90, 180] as const).map((value) => <button type="button" className={analysisDays === value ? "active" : ""} key={value} onClick={() => setAnalysisDays(value)}>
              <strong>{value} dage</strong>
              <small>{value === 30 ? "Seneste" : value === 60 ? "Kort sigt" : value === 90 ? "Standard" : "Langt blik"}</small>
            </button>)}
          </div>
        </fieldset>

        <fieldset className="miyagi-option-group">
          <legend>Længde</legend>
          <div>
            {(["short", "normal", "deep"] as const).map((value) => <button type="button" className={analysisLength === value ? "active" : ""} key={value} onClick={() => setAnalysisLength(value)}>
              <strong>{value === "short" ? "Kort" : value === "normal" ? "Normal" : "Grundig"}</strong>
              <small>{value === "short" ? "Det vigtigste" : value === "normal" ? "Balanceret" : "Gå på opdagelse"}</small>
            </button>)}
          </div>
        </fieldset>

        <fieldset className="miyagi-option-group">
          <legend>Tone</legend>
          <div>
            {(["objective", "empathetic", "miyagi"] as const).map((value) => <button type="button" className={analysisTone === value ? "active" : ""} key={value} onClick={() => setAnalysisTone(value)}>
              <strong>{value === "objective" ? "Objektiv" : value === "empathetic" ? "Empatisk" : "Mr. Miyagi"}</strong>
              <small>{value === "objective" ? "Nøgtern" : value === "empathetic" ? "Menneskelig" : "Wax on 😄"}</small>
            </button>)}
          </div>
        </fieldset>

        <div className="miyagi-analysis-dialog-actions">
          <span>Valgt: <strong>{analysisDays} dage · {analysisLength === "short" ? "Kort" : analysisLength === "normal" ? "Normal" : "Grundig"} · {analysisTone === "objective" ? "Objektiv" : analysisTone === "empathetic" ? "Empatisk" : "Mr. Miyagi"}</strong></span>
          <button className="primary-action" type="button" onClick={() => void runAnalysis()}>Start analyse</button>
        </div>
      </section>
    </div>}

    {historyOpen && <MiyagiHistory onClose={() => setHistoryOpen(false)} />}
  </section>;
}
