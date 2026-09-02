import { useEffect, useState } from "react";

type Agent = { id: string; name: string; lastSeenAt: string | null; createdAt: string };
type SyncJob = {
  id: string;
  status: "queued" | "running" | "processing" | "complete" | "failed";
  message: string | null;
  requestedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
  queuePosition?: number | null;
  queueAhead?: number | null;
};
type CredentialState = { configured: boolean; username: string | null; updatedAt: string | null };
type SyncSchedule = { enabled: boolean; syncHours: number[]; timeZone: string };

const DEFAULT_SYNC_HOURS = [9, 12, 18, 22];
const MAX_SYNCS_PER_DAY = 6;

function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

function hasValidScheduleSpacing(hours: number[]): boolean {
  for (let left = 0; left < hours.length; left += 1) {
    for (let right = left + 1; right < hours.length; right += 1) {
      const difference = Math.abs(hours[left] - hours[right]);
      if (Math.min(difference, 24 - difference) < 3) return false;
    }
  }
  return true;
}

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

function elapsed(value: string | null): string {
  if (!value) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1000));
  if (seconds < 60) return `Kører i ${seconds} sek`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `Kører i ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `Kører i ${hours} t${rest ? ` ${rest} min` : ""}`;
}

function isOnline(agent: Agent | null): boolean {
  return !!agent?.lastSeenAt && Date.now() - Date.parse(agent.lastSeenAt) < 90_000;
}

function syncLabel(job: SyncJob): string {
  if (job.status === "failed") return job.message ? `Fejlet: ${job.message}` : "Synkronisering fejlede";
  if (job.status === "queued") {
    if (job.queuePosition && job.queuePosition > 1) return `Venter i kø · nr. ${job.queuePosition}`;
    if (job.queuePosition === 1) return "Næste i køen";
    return job.message ?? "Venter på Garmin-agent";
  }
  if (job.message) return job.message;
  if (job.status === "running") return "Henter data fra Garmin";
  if (job.status === "processing") return "Importerer data i Nexus";
  return "Synkronisering færdig";
}

function queueDescription(job: SyncJob): string | null {
  if (job.status !== "queued" || job.queueAhead == null) return null;
  if (job.queueAhead === 0) return "Ingen jobs foran dig. Agenten tager din synkronisering som den næste.";
  if (job.queueAhead === 1) return "1 synkronisering er foran dig.";
  return `${job.queueAhead} synkroniseringer er foran dig.`;
}

function syncPercent(job: SyncJob): number {
  if (job.status === "complete" || job.status === "failed") return 100;
  if (job.status === "queued") return 8;
  if (job.status === "processing") return 85;
  const message = (job.message ?? "").toLowerCase();
  if (message.includes("forbereder")) return 15;
  if (message.includes("pakker")) return 55;
  if (message.includes("uploader")) return 70;
  return 35;
}

async function errorText(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: string; detail?: string };
    return body.detail ?? body.error ?? `HTTP ${response.status}`;
  } catch { return `HTTP ${response.status}`; }
}

export default function GarminAgentSettings() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [canManageAgent, setCanManageAgent] = useState(false);
  const [job, setJob] = useState<SyncJob | null>(null);
  const [credentials, setCredentials] = useState<CredentialState>({ configured: false, username: null, updatedAt: null });
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [credentialBusy, setCredentialBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [credentialMessage, setCredentialMessage] = useState<string | null>(null);
  const [schedule, setSchedule] = useState<SyncSchedule>({ enabled: true, syncHours: DEFAULT_SYNC_HOURS, timeZone: "Europe/Copenhagen" });
  const [scheduleState, setScheduleState] = useState<"loading" | "ready" | "error">("loading");
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const [scheduleMessage, setScheduleMessage] = useState<string | null>(null);

  async function refresh() {
    try {
      const [agentsResponse, syncResponse, credentialsResponse] = await Promise.all([
        fetch("/api/garmin/agents", { credentials: "same-origin", cache: "no-store" }),
        fetch("/api/garmin/sync", { credentials: "same-origin", cache: "no-store" }),
        fetch("/api/garmin/credentials", { credentials: "same-origin", cache: "no-store" }),
      ]);
      if (!agentsResponse.ok) throw new Error(await errorText(agentsResponse));
      if (!syncResponse.ok) throw new Error(await errorText(syncResponse));
      if (!credentialsResponse.ok) throw new Error(await errorText(credentialsResponse));

      const agentBody = await agentsResponse.json() as { agents: Agent[]; canManage?: boolean };
      const credentialBody = await credentialsResponse.json() as CredentialState;
      setAgents(agentBody.agents);
      setCanManageAgent(!!agentBody.canManage);
      setJob((await syncResponse.json() as { job: SyncJob | null }).job);
      setCredentials(credentialBody);
      if (credentialBody.username) setUsername(credentialBody.username);
      setState("ready");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "agent_status_failed");
      setState("error");
    }
  }

  async function loadSchedule() {
    try {
      const response = await fetch("/api/garmin/schedule", { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error(await errorText(response));
      const body = await response.json() as { schedule: SyncSchedule };
      setSchedule(body.schedule);
      setScheduleState("ready");
    } catch (error) {
      setScheduleMessage(error instanceof Error ? error.message : "garmin_schedule_load_failed");
      setScheduleState("error");
    }
  }

  useEffect(() => {
    void refresh();
    void loadSchedule();
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => window.clearInterval(timer);
  }, []);

  function updateSyncHour(index: number, hour: number) {
    setSchedule((current) => ({
      ...current,
      syncHours: current.syncHours.map((value, position) => position === index ? hour : value).sort((left, right) => left - right),
    }));
    setScheduleMessage(null);
  }

  function addSyncHour() {
    const preferred = [...DEFAULT_SYNC_HOURS, ...Array.from({ length: 24 }, (_, hour) => hour)];
    const hour = preferred.find((candidate) => (
      !schedule.syncHours.includes(candidate)
      && hasValidScheduleSpacing([...schedule.syncHours, candidate])
    ));
    if (hour === undefined) {
      setScheduleMessage("Der er ikke plads til flere tidspunkter med mindst tre timers mellemrum.");
      return;
    }
    setSchedule((current) => ({ ...current, syncHours: [...current.syncHours, hour].sort((left, right) => left - right) }));
    setScheduleMessage(null);
  }

  function removeSyncHour(index: number) {
    if (schedule.syncHours.length === 1) return;
    setSchedule((current) => ({ ...current, syncHours: current.syncHours.filter((_, position) => position !== index) }));
    setScheduleMessage(null);
  }

  async function saveSchedule() {
    if (!hasValidScheduleSpacing(schedule.syncHours) || new Set(schedule.syncHours).size !== schedule.syncHours.length) {
      setScheduleMessage("Tidspunkterne skal være forskellige og have mindst tre timers mellemrum.");
      return;
    }
    setScheduleBusy(true); setScheduleMessage(null);
    try {
      const response = await fetch("/api/garmin/schedule", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: schedule.enabled, syncHours: schedule.syncHours }),
      });
      if (!response.ok) throw new Error(await errorText(response));
      const body = await response.json() as { schedule: SyncSchedule };
      setSchedule(body.schedule);
      setScheduleMessage("Synkroniseringstiderne er gemt.");
    } catch (error) {
      setScheduleMessage(error instanceof Error ? error.message : "garmin_schedule_save_failed");
    } finally { setScheduleBusy(false); }
  }

  async function saveCredentials() {
    if (!username.trim() || !password) {
      setCredentialMessage("Indtast både Garmin-login og password.");
      return;
    }
    setCredentialBusy(true); setCredentialMessage(null);
    try {
      const response = await fetch("/api/garmin/credentials", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      if (!response.ok) throw new Error(await errorText(response));
      const body = await response.json() as CredentialState;
      setCredentials(body);
      setUsername(body.username ?? username.trim());
      setPassword("");
      setCredentialMessage("Garmin-login er gemt krypteret i Nexus.");
    } catch (error) {
      setCredentialMessage(error instanceof Error ? error.message : "garmin_credentials_save_failed");
    } finally { setCredentialBusy(false); }
  }

  async function removeCredentials() {
    if (!window.confirm("Fjern dit gemte Garmin-login fra Nexus? Eksisterende importerede data bliver ikke slettet.")) return;
    setCredentialBusy(true); setCredentialMessage(null);
    try {
      const response = await fetch("/api/garmin/credentials", { method: "DELETE", credentials: "same-origin" });
      if (!response.ok) throw new Error(await errorText(response));
      setCredentials({ configured: false, username: null, updatedAt: null });
      setUsername("");
      setPassword("");
      setCredentialMessage("Garmin-login er fjernet.");
    } catch (error) {
      setCredentialMessage(error instanceof Error ? error.message : "garmin_credentials_delete_failed");
    } finally { setCredentialBusy(false); }
  }

  async function createAgent() {
    setBusy(true); setMessage(null);
    try {
      const response = await fetch("/api/garmin/agents", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Nexus Garmin agent" }),
      });
      if (!response.ok) throw new Error(await errorText(response));
      const body = await response.json() as { token: string };
      setToken(body.token);
      setShowSetup(true);
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "agent_create_failed"); }
    finally { setBusy(false); }
  }

  async function rotateToken() {
    if (!window.confirm("Generér et nyt agent-token? Det gamle token stopper med at virke med det samme.")) return;
    setBusy(true); setMessage(null);
    try {
      const response = await fetch("/api/garmin/agents/token", { method: "POST", credentials: "same-origin" });
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
      window.setTimeout(() => void refresh(), 500);
    } catch (error) { setMessage(error instanceof Error ? error.message : "garmin_sync_failed"); }
    finally { setBusy(false); }
  }

  const agent = agents[0] ?? null;
  const online = isOnline(agent);
  const active = job && ["queued", "running", "processing"].includes(job.status);
  const interrupted = !!job && !online && ["running", "processing"].includes(job.status);
  const statusLabel = !agent ? "Ikke installeret" : online ? "Online" : "Offline";
  const queueInfo = job ? queueDescription(job) : null;

  if (state === "loading") return <div className="garmin-agent-panel"><p className="settings-loading">Henter Garmin-indstillinger…</p></div>;

  return <section className="garmin-agent-panel">
    <div className="garmin-agent-heading">
      <div><p className="section-label">Garmin Connect</p><h3>Din Garmin-konto</h3><p>Nexus bruger loginet til at lade den fælles GarminDB-agent hente og opdatere dine egne data.</p></div>
      <span className={`garmin-agent-status ${credentials.configured ? "online" : ""}`}><i />{credentials.configured ? "Konto gemt" : "Ikke sat op"}</span>
    </div>

    <div className="garmin-credential-form">
      <label><span>Garmin Connect login</span><input type="email" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="navn@example.com" /></label>
      <label><span>Garmin Connect password</span><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={credentials.configured ? "Indtast kun for at ændre/gemme igen" : "Password"} /></label>
      <div className="garmin-agent-actions">
        <button className="primary-action" type="button" disabled={credentialBusy || !username.trim() || !password} onClick={() => void saveCredentials()}>{credentialBusy ? "Gemmer…" : credentials.configured ? "Opdatér Garmin-login" : "Gem Garmin-login"}</button>
        {credentials.configured && <button className="secondary-action" type="button" disabled={credentialBusy} onClick={() => void removeCredentials()}>Fjern login</button>}
        {credentials.updatedAt && <span>Sidst ændret {age(credentials.updatedAt)}.</span>}
      </div>
      <p className="settings-help">Login og password krypteres med AES-GCM før de gemmes i D1. Passwordet sendes kun til den godkendte Garmin-agent, når et sync-job for din bruger kører.</p>
      {credentialMessage && <p className={`settings-feedback ${credentialMessage.includes("gemt") || credentialMessage.includes("fjernet") ? "success" : "error"}`}>{credentialMessage}</p>}
    </div>

    <div className="garmin-agent-heading garmin-agent-heading--service">
      <div><p className="section-label">Automatisk synkronisering</p><h3>Fælles GarminDB-agent</h3><p>Én persistent container kan servicere alle Nexus-brugere. GarminDB-state og data holdes isoleret pr. bruger inde i agenten.</p></div>
      <span className={`garmin-agent-status ${online ? "online" : ""}`}><i />{statusLabel}</span>
    </div>

    <div className="garmin-schedule-panel">
      <div className="garmin-schedule-heading">
        <div>
          <strong>Planlagte synkroniseringer</strong>
          <span>{schedule.enabled ? `${schedule.syncHours.length} gange dagligt · dansk tid` : "Automatisk synkronisering er slået fra"}</span>
        </div>
        <label className="garmin-schedule-toggle">
          <input
            type="checkbox"
            checked={schedule.enabled}
            disabled={scheduleState === "loading" || scheduleBusy}
            onChange={(event) => {
              setSchedule((current) => ({ ...current, enabled: event.target.checked }));
              setScheduleMessage(null);
            }}
          />
          <span>Automatisk</span>
        </label>
      </div>

      {scheduleState === "loading" && <p className="settings-help">Henter synkroniseringstider…</p>}
      {scheduleState !== "loading" && <div className={`garmin-schedule-times ${schedule.enabled ? "" : "is-disabled"}`}>
        {schedule.syncHours.map((hour, index) => (
          <div className="garmin-schedule-time" key={`${index}-${hour}`}>
            <label>
              <span className="visually-hidden">Synkronisering {index + 1}</span>
              <select
                value={hour}
                disabled={!schedule.enabled || scheduleBusy}
                onChange={(event) => updateSyncHour(index, Number(event.target.value))}
              >
                {Array.from({ length: 24 }, (_, value) => <option value={value} key={value}>{hourLabel(value)}</option>)}
              </select>
            </label>
            <button
              className="garmin-schedule-remove"
              type="button"
              aria-label={`Fjern synkronisering kl. ${hourLabel(hour)}`}
              disabled={!schedule.enabled || scheduleBusy || schedule.syncHours.length === 1}
              onClick={() => removeSyncHour(index)}
            >×</button>
          </div>
        ))}
      </div>}

      {scheduleState !== "loading" && <div className="garmin-agent-actions">
        <button className="secondary-action" type="button" disabled={!schedule.enabled || scheduleBusy || schedule.syncHours.length >= MAX_SYNCS_PER_DAY} onClick={addSyncHour}>Tilføj tidspunkt</button>
        <button className="primary-action" type="button" disabled={scheduleBusy || !hasValidScheduleSpacing(schedule.syncHours)} onClick={() => void saveSchedule()}>{scheduleBusy ? "Gemmer…" : "Gem tider"}</button>
        <span>Mindst tre timer mellem hvert tidspunkt. Maksimalt seks pr. dag.</span>
      </div>}
      {scheduleMessage && <p className={`settings-feedback ${scheduleMessage.includes("gemt") ? "success" : "error"}`}>{scheduleMessage}</p>}
    </div>

    {state === "error" && <p className="settings-feedback error">Garmin-status kunne ikke hentes: {message}</p>}

    {state === "ready" && !agent && canManageAgent && <div className="garmin-agent-empty">
      <div><strong>Ingen fælles agent registreret</strong><span>Opret installation-tokenet og brug det i den ene Nexus Garmin-container på Unraid.</span></div>
      <button className="primary-action" type="button" disabled={busy} onClick={() => void createAgent()}>{busy ? "Opretter…" : "Opsæt Garmin-agent"}</button>
    </div>}

    {state === "ready" && !agent && !canManageAgent && <p className="settings-feedback error">Nexus-administratoren har ikke installeret Garmin-agenten endnu.</p>}

    {agent && <>
      <div className="garmin-agent-grid">
        <div><span>Agent</span><strong>{statusLabel}</strong><small>{agent.lastSeenAt ? `Sidst set ${age(agent.lastSeenAt)}` : "Containeren har ikke checket ind endnu"}</small></div>
        <div><span>Din seneste sync</span><strong>{job?.status === "complete" ? "Færdig" : job?.status === "failed" ? "Fejlet" : job?.status === "queued" ? "I kø" : interrupted ? "Venter" : job ? "Kører" : "Ingen endnu"}</strong><small>{job?.completedAt ? age(job.completedAt) : job?.requestedAt ? `Bestilt ${age(job.requestedAt)}` : "—"}</small></div>
      </div>

      {job && <div className={`garmin-sync-progress status-${job.status}`}>
        <div className="garmin-sync-progress-heading">
          <div><span>Synkronisering</span><strong>{interrupted ? "Afbrudt · venter på Garmin-agent" : syncLabel(job)}</strong></div>
          <span>{job.status === "queued" && job.queuePosition ? `Nr. ${job.queuePosition} i køen` : interrupted ? "Genoptages automatisk" : active ? elapsed(job.startedAt ?? job.requestedAt) : job.completedAt ? `Afsluttet ${age(job.completedAt)}` : ""}</span>
        </div>
        <div className="garmin-sync-track" role="progressbar" aria-label="Garmin synkronisering" aria-valuemin={0} aria-valuemax={100} aria-valuenow={syncPercent(job)}>
          <span style={{ width: `${syncPercent(job)}%` }} />
        </div>
        {queueInfo && <small>{queueInfo}</small>}
        {interrupted && <small>Jobbet beholdes. Når Garmin-agenten kommer online igen, fortsætter Nexus automatisk fra den relevante fase.</small>}
        {active && !queueInfo && !interrupted && <small>Fasen opdateres automatisk cirka hvert 10. sekund. Procenten viser processen, ikke Garmins interne download-procent.</small>}
      </div>}

      <div className="garmin-agent-actions">
        <button className="primary-action" type="button" disabled={busy || !!active || !credentials.configured} onClick={() => void requestSync()}>{job?.status === "queued" ? "Garmin-synkronisering er i kø…" : active ? "Garmin-synkronisering kører…" : "Opdatér fra Garmin"}</button>
        {canManageAgent && <button className="secondary-action" type="button" onClick={() => setShowSetup((value) => !value)}>{showSetup ? "Skjul agent-setup" : "Vis agent-setup"}</button>}
        {canManageAgent && <button className="secondary-action" type="button" disabled={busy} onClick={() => void rotateToken()}>Generér nyt agent-token</button>}
        {!credentials.configured && <span>Gem først dit Garmin-login.</span>}
        {credentials.configured && !online && !active && <span>Sync kan sættes i kø; agenten tager jobbet næste gang containeren er online.</span>}
      </div>
      {job?.status === "failed" && <p className="settings-feedback error">Seneste Garmin-sync fejlede{job.message ? `: ${job.message}` : "."}</p>}
    </>}

    {canManageAgent && showSetup && <div className="garmin-agent-token">
      <p className="section-label">Unraid agent setup</p>
      <strong>{token ? "Nyt installation-token er klar — kopiér det nu" : "Installationsvejledning"}</strong>
      {token ? <code>{token}</code> : <p>Det aktive agent-token kan ikke vises igen, fordi Nexus kun gemmer hash'en. Brug “Generér nyt agent-token” hvis du mangler det.</p>}
      <div className="garmin-agent-setup">
        <code>NEXUS_URL=https://nexus.sr-goodjob.workers.dev</code>
        <code>NEXUS_GARMIN_AGENT_TOKEN={token ?? "<generér-nyt-token>"}</code>
        <code>/mnt/user/appdata/nexus-garmin/state → /state</code>
        <code>/mnt/user/appdata/nexus-garmin/data → /data</code>
      </div>
      <p>Dette token tilhører installationen, ikke en bestemt Garmin-bruger. Ét token og én container servicerer alle Nexus-brugere.</p>
    </div>}

    {message && state === "ready" && <p className="settings-feedback error">{message}</p>}
  </section>;
}
