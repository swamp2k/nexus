import { useEffect, useMemo, useState } from "react";

type Analysis = {
  id: string;
  periodDays: number;
  periodStart: string;
  periodEnd: string;
  model: string;
  contextHash: string;
  analysis: string;
  createdAt: string;
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

function AnalysisText({ text }: { text: string }) {
  const blocks = useMemo(() => text.split("\n").map((line) => line.trimEnd()), [text]);
  return <div className="miyagi-analysis-text">
    {blocks.map((line, index) => {
      const key = `${index}-${line.slice(0, 20)}`;
      if (!line.trim()) return <div className="miyagi-analysis-gap" key={key} />;
      if (line.startsWith("## ")) return <h3 key={key}>{line.slice(3)}</h3>;
      if (line.startsWith("### ")) return <h4 key={key}>{line.slice(4)}</h4>;
      if (/^[-*] /.test(line)) return <p className="miyagi-analysis-bullet" key={key}>{line.slice(2)}</p>;
      return <p key={key}>{line}</p>;
    })}
  </div>;
}

export default function MiyagiWorkspace() {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "analyzing" | "error">("loading");
  const [chatText, setChatText] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  async function runAnalysis() {
    setState("analyzing");
    setError(null);
    try {
      const response = await fetch("/api/wellbeing/miyagi/analyze", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days: 90 }),
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
    <div className="miyagi-intro">
      <div>
        <p className="section-label">Mr. Miyagi</p>
        <h2>Se efter mønstre, ikke mirakler.</h2>
        <p>Miyagi krydsrefererer dine sidste 90 dages sundhed, motion, check-ins og journal. Han leder efter gentagne sammenfald og fortæller også, når datagrundlaget er for tyndt.</p>
      </div>
      <button className="primary-action" type="button" disabled={state === "loading" || state === "analyzing"} onClick={() => void runAnalysis()}>
        {state === "analyzing" ? "Miyagi tænker…" : analysis ? "Analysér igen" : "Start analyse"}
      </button>
    </div>

    <div className="miyagi-source-grid" aria-label="Datakilder til analysen">
      <div><span>♥</span><strong>Sundhed</strong><small>Søvn, puls, stress, Body Battery, skridt</small></div>
      <div><span>↗</span><strong>Motion</strong><small>Aktiviteter, varighed, intensitet og historik</small></div>
      <div><span>☀</span><strong>Check-ins</strong><small>Dine egne daglige målepunkter</small></div>
      <div><span>✎</span><strong>Journal</strong><small>Det du selv skrev om dagen</small></div>
    </div>

    {state === "loading" && <div className="miyagi-empty-analysis"><strong>Finder den seneste analyse…</strong></div>}
    {state === "analyzing" && <div className="miyagi-thinking"><span className="miyagi-thinking-dot" /><div><strong>Miyagi lægger dagene ved siden af hinanden…</strong><p>90 dages data bliver samlet og gennemgået. Det kan tage lidt tid.</p></div></div>}

    {analysis && state !== "analyzing" && <section className="miyagi-analysis-card">
      <header className="miyagi-analysis-meta">
        <div><strong>Analyse</strong><span>{formatDate(analysis.periodStart)} – {formatDate(analysis.periodEnd)}</span></div>
        <small>{formatTimestamp(analysis.createdAt)}</small>
      </header>
      <AnalysisText text={analysis.analysis} />
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
      <p>Tryk på <em>Start analyse</em>. Miyagi bruger kun dine egne Nexus-data og gemmer analysen, så du kan spørge ind til præcis samme datagrundlag bagefter.</p>
    </div>}

    {analysis && <section className="miyagi-conversation">
      <div className="miyagi-conversation-heading"><strong>Tal med Miyagi</strong><span>Spørg ind til fundene eller bed ham uddybe et mønster.</span></div>
      {messages.length > 0 && <div className="miyagi-messages">{messages.map((message, index) => <article className={`miyagi-message ${message.role}`} key={message.id ?? `${message.createdAt}-${index}`}>
        <strong>{message.role === "assistant" ? "Miyagi" : "Dig"}</strong>
        <p>{message.body}</p>
      </article>)}</div>}
      <form className="miyagi-chat-shell" onSubmit={(event) => { event.preventDefault(); void sendMessage(); }}>
        <input value={chatText} onChange={(event) => setChatText(event.target.value)} disabled={chatBusy} maxLength={4000} placeholder="Spørg Miyagi om analysen…" aria-label="Spørg Mr. Miyagi" />
        <button type="submit" disabled={chatBusy || !chatText.trim()}>{chatBusy ? "…" : "Send"}</button>
      </form>
    </section>}

    {error && <p className="settings-feedback error">{error}</p>}
    <small className="miyagi-disclaimer">Miyagi er et analyseværktøj i et privat hobbyprojekt. Han kan hjælpe med mønstre og refleksion, men er ikke læge og erstatter ikke faglig vurdering.</small>
  </section>;
}
