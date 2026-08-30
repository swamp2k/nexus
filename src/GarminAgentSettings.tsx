import { useEffect, useState } from "react";

type Agent = { id: string; name: string; lastSeenAt: string | null; createdAt: string };
type SyncJob = { id: string; status: "queued" | "running" | "processing" | "complete" | "failed"; message: string | null; requestedAt: string; startedAt: string | null; completedAt: string | null; updatedAt: string };

function age(value: string | null): string {
  if (!value) return "aldrig";
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 1000));
  if (seconds < 60) return `${seconds} sek siden`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min siden`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} t siden`;
  return new Intl.DateTimeFormat("da-DK", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function isOnline(agent: Agent | null): boolean {
  return !!agent?.lastSeenAt && Date.now() - Date.parse(agent.lastSeenAt) < 90_000;
}

async function errorText(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: string; detail?: string };
    return body.detail ?? body.error ?? `HTTP ${response.status}`;
  } catch { return `HTTP ${response.status}`; }
}

export default function GarminAgentSettings() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [job, setJob] = useState<SyncJob | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    try {
      const [agentsResponse, syncResponse] = await Promise.all([
        fetch("/api/garmin/agents", { credentials: "same-origin", cache: "no-store" }),
        fetch("/api/garmin/sync", { credentials: "same-origin", cache: "no-store" }),
      ]);
      if (!agentsResponse.ok) throw new Error(await errorText(agentsResponse));
      if (!syncResponse.ok) throw new Error(await errorText(syncResponse));
      setAgents((await agentsResponse.json() as { agents: Agent[] }).agents);
      setJob((await syncResponse.json() as { job: SyncJob | null }).job);
      setState("ready");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "agent_status_failed");
      setState("error");
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => window.clearInterval(timer);
  }, []);

  async function createAgent() {
    setBusy(true); setMessage(null);
    try {
      const response = await fetch("/api/garmin/agents", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "GarminDB agent" }),
      });
      if (!response.ok) throw new Error(await errorText(response));
      const body = await response.json() as { token: string };
      setToken(body.token);
      setShowSetup(true);
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "agent_create_failed"); }
    finally { setBusy(false); }
  }

  async function rotateToken(agentId: string) {
    if (!window.confirm("Generér et nyt agent-token? Det gamle token stopper med at virke med det samme.")) return;
    setBusy(true); setMessage(null);
    try {
      const response = await fetch(`/api/garmin/agents/${agentId}/token`, { method: "POST", credentials: "same-origin" });
      if (!response.ok) throw new Error(await errorText(response));
      const body = await response.json() as { token: string };
      setToken(body.token);
      setShowSetup(true);
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "agent_token_rotate_failed"); }
    finally { setBusy(false); }
  }

  async function requestSync() {
    setBusy(true); setMessage(null);
    try {
      const response = await fetch("/api/garmin/sync", { method: "POST", credentials: "same-origin" });
      if (!response.ok) throw new Error(await errorText(response));
      setJob((await response.json() as { job: SyncJob }).job);
    } catch (error) { setMessage(error instanceof Error ? error.message : "garmin_sync_failed"); }
    finally { setBusy(false); }
  }

  const agent = agents[0] ?? null;
  const online = isOnline(agent);
  const active = job && ["queued", "running", "processing"].includes(job.status);
  const statusLabel = !agent ? "Ikke sat op" : online ? "Online" : "Offline";

  if (state === "loading") return <div className="garmin-agent-panel"><p className="settings-loading">Henter Garmin-agent…</p></div>;

  return <section className="garmin-agent-panel">
    <div className="garmin-agent-heading">
      <div><p className="section-label">Automatisk synkronisering</p><h3>GarminDB-agent</h3><p>Agenten kører GarminDB på din egen maskine og sender kun de hentede Garmin-data til Nexus.</p></div>
      <span className={`garmin-agent-status ${online ? "online" : ""}`}><i />{statusLabel}</span>
    </div>

    {state === "error" && <p className="settings-feedback error">Agent-status kunne ikke hentes: {message}</p>}

    {state === "ready" && !agent && <div className="garmin-agent-empty">
      <div><strong>Ingen agent registreret</strong><span>Opret agenten her. Garmin-login bliver på maskinen hvor GarminDB kører.</span></div>
      <button className="primary-action" type="button" disabled={busy} onClick={() => void createAgent()}>{busy ? "Opretter…" : "Opsæt Garmin-agent"}</button>
    </div>}

    {agent && <>
      <div className="garmin-agent-grid">
        <div><span>Status</span><strong>{statusLabel}</strong><small>{agent.lastSeenAt ? `Sidst set ${age(agent.lastSeenAt)}` : "Agenten har ikke checket ind endnu"}</small></div>
        <div><span>Seneste sync</span><strong>{job?.status === "complete" ? "Færdig" : job?.status === "failed" ? "Fejlet" : job ? job.status : "Ingen endnu"}</strong><small>{job?.completedAt ? age(job.completedAt) : job?.requestedAt ? `Startet ${age(job.requestedAt)}` : "—"}</small></div>
      </div>
      <div className="garmin-agent-actions">
        <button className="primary-action" type="button" disabled={busy || !!active} onClick={() => void requestSync()}>{active ? `Garmin sync: ${job?.status}` : "Opdatér fra Garmin"}</button>
        <button className="secondary-action" type="button" onClick={() => setShowSetup((value) => !value)}>{showSetup ? "Skjul setup" : "Vis setup"}</button>
        <button className="secondary-action" type="button" disabled={busy} onClick={() => void rotateToken(agent.id)}>Generér nyt token</button>
        {!online && <span>Agenten behøver ikke være online for at sætte jobbet i kø; den tager det næste gang den starter.</span>}
      </div>
      {job?.status === "failed" && <p className="settings-feedback error">Seneste Garmin-sync fejlede{job.message ? `: ${job.message}` : "."}</p>}
    </>}

    {showSetup && <div className="garmin-agent-token">
      <p className="section-label">Agent setup</p>
      <strong>{token ? "Nyt token er klar — kopiér det nu" : "Installationsvejledning"}</strong>
      {token ? <code>{token}</code> : <p>Det aktive token kan ikke vises igen, fordi Nexus kun gemmer det som hash. Brug “Generér nyt token” for at få et nyt.</p>}
      <div className="garmin-agent-setup">
        <code>NEXUS_URL=https://nexus.sr-goodjob.workers.dev</code>
        <code>NEXUS_GARMIN_AGENT_TOKEN={token ?? "<generér-nyt-token>"}</code>
        <code>python3 tools/nexus-garmin-agent.py</code>
      </div>
      <p>Et nyt token invaliderer det gamle med det samme. GarminDB-login forbliver lokalt på agentmaskinen.</p>
    </div>}

    {message && state === "ready" && <p className="settings-feedback error">{message}</p>}
  </section>;
}
