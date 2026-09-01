import { useEffect, useState } from "react";
import GarminHealthDetail from "./GarminHealthDetail";
import type { GarminHealthMetric } from "./GarminHealthDetail";
import GarminSleepDetail from "./GarminSleepDetail";

type GarminOverview = {
  daily: Record<string, unknown> | null;
  sleep: Record<string, unknown> | null;
  rhr: Record<string, unknown> | null;
  counts: { dailyCount?: number; sleepCount?: number } | null;
};

type GarminSyncJob = {
  id: string;
  status: "queued" | "running" | "processing" | "complete" | "failed";
  message: string | null;
  queuePosition?: number | null;
};

type DeepDive = "sleep" | GarminHealthMetric | null;

function hours(seconds: unknown): string {
  const value = typeof seconds === "number" ? seconds : Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return "—";
  const h = Math.floor(value / 3600);
  const m = Math.round((value % 3600) / 60);
  return `${h} t ${m} min`;
}

function numberValue(row: Record<string, unknown> | null, key: string): number | null {
  const value = row?.[key];
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export default function GarminPage() {
  const [overview, setOverview] = useState<GarminOverview | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [deepDive, setDeepDive] = useState<DeepDive>(null);
  const [syncJob, setSyncJob] = useState<GarminSyncJob | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  async function loadOverview() {
    const response = await fetch("/api/garmin/overview", { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json() as GarminOverview;
    setOverview(data);
    setState("ready");
  }

  useEffect(() => {
    void loadOverview().catch(() => setState("error"));
  }, []);

  useEffect(() => {
    if (!syncing) return;
    let cancelled = false;
    let timer = 0;

    const poll = async () => {
      try {
        const response = await fetch("/api/garmin/sync", { credentials: "same-origin", cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = await response.json() as { job: GarminSyncJob | null };
        if (cancelled) return;
        setSyncJob(body.job);
        if (!body.job || body.job.status === "failed") {
          setSyncing(false);
          if (body.job?.status === "failed") setSyncError(body.job.message || "Garmin-opdateringen fejlede.");
          return;
        }
        if (body.job.status === "complete") {
          setSyncing(false);
          setSyncError(null);
          await loadOverview();
          return;
        }
        timer = window.setTimeout(() => void poll(), 2500);
      } catch {
        if (!cancelled) {
          setSyncing(false);
          setSyncError("Kunne ikke følge Garmin-opdateringen.");
        }
      }
    };

    void poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [syncing]);

  async function refreshGarmin() {
    setSyncError(null);
    try {
      const response = await fetch("/api/garmin/sync", {
        method: "POST",
        credentials: "same-origin",
      });
      const body = await response.json() as { job?: GarminSyncJob; error?: string };
      if (!response.ok || !body.job) throw new Error(body.error || `HTTP ${response.status}`);
      setSyncJob(body.job);
      setSyncing(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "garmin_sync_failed";
      setSyncError(message === "garmin_credentials_not_configured"
        ? "Garmin-login er ikke konfigureret for brugeren."
        : message === "garmin_agent_not_configured"
          ? "Garmin-agenten er ikke konfigureret."
          : "Garmin-opdateringen kunne ikke startes.");
    }
  }

  const daily = overview?.daily ?? null;
  const sleep = overview?.sleep ?? null;
  const latestRhr = numberValue(overview?.rhr ?? null, "resting_hr") ?? numberValue(daily, "resting_hr");
  const dailyDate = String(daily?.date ?? "");
  const dailyCount = overview?.counts?.dailyCount ?? 0;
  const sleepCount = overview?.counts?.sleepCount ?? 0;

  if (state === "loading") return <section className="garmin-page"><p className="empty-state">Henter Garmin-data…</p></section>;
  if (state === "error") return <section className="garmin-page"><p className="empty-state">Garmin-data kunne ikke hentes.</p></section>;

  const syncLabel = syncing
    ? syncJob?.status === "queued" && syncJob.queuePosition
      ? `I kø · nr. ${syncJob.queuePosition}`
      : syncJob?.message || "Opdaterer Garmin…"
    : "Opdatér Garmin";

  const headingActions = <div className="garmin-health-heading-actions">
    <span>{dailyCount} dage · {sleepCount} nætter</span>
    <button className="garmin-refresh-button" type="button" disabled={syncing} onClick={() => void refreshGarmin()}>{syncLabel}</button>
  </div>;

  return (
    <section className="garmin-page" aria-label="Garmin">
      {!daily && <p className="empty-state">Der er endnu ingen normaliserede Garmin-data. Importen styres under Indstillinger → Garmin.</p>}
      {syncError && <p className="garmin-sync-error">{syncError}</p>}

      {daily && <>
        {deepDive ? <section className="garmin-health-overview garmin-health-collapsed">
          <div className="garmin-health-heading">
            <div><p className="section-label">Seneste data</p><h3>{dailyDate}</h3></div>
            {headingActions}
          </div>
        </section> : <section className="garmin-health-overview">
          <div className="garmin-health-heading"><div><p className="section-label">Seneste data</p><h3>{dailyDate}</h3></div>{headingActions}</div>
          <div className="garmin-metric-grid">
            <button className="garmin-metric-card garmin-metric-action" type="button" onClick={() => setDeepDive("steps")}><span>Skridt</span><strong>{numberValue(daily, "steps")?.toLocaleString("da-DK") ?? "—"}</strong><small>Mål {numberValue(daily, "step_goal")?.toLocaleString("da-DK") ?? "—"}</small><em>Se detaljer ›</em></button>
            <button className="garmin-metric-card garmin-metric-action" type="button" onClick={() => setDeepDive("heart")}><span>Hvilepuls</span><strong>{latestRhr === null ? "—" : `${Math.round(latestRhr)} bpm`}</strong><small>{numberValue(daily, "min_hr") ?? "—"}–{numberValue(daily, "max_hr") ?? "—"} bpm</small><em>Se detaljer ›</em></button>
            <button className="garmin-metric-card garmin-metric-action" type="button" onClick={() => setDeepDive("bodyBattery")}><span>Body Battery</span><strong>{numberValue(daily, "body_battery_latest") ?? "—"}</strong><small>{numberValue(daily, "body_battery_low") ?? "—"} → {numberValue(daily, "body_battery_high") ?? "—"}</small><em>Se detaljer ›</em></button>
            <button className="garmin-metric-card garmin-metric-action" type="button" onClick={() => setDeepDive("stress")}><span>Stress</span><strong>{numberValue(daily, "avg_stress") ?? "—"}</strong><small>Maks {numberValue(daily, "max_stress") ?? "—"}</small><em>Se detaljer ›</em></button>
            <button className="garmin-metric-card garmin-metric-action" type="button" onClick={() => setDeepDive("sleep")}><span>Søvn</span><strong>{hours(sleep?.sleep_seconds)}</strong><small>Dyb {hours(sleep?.deep_seconds)} · REM {hours(sleep?.rem_seconds)}</small><em>Se detaljer ›</em></button>
            <button className="garmin-metric-card garmin-metric-action" type="button" onClick={() => setDeepDive("respiration")}><span>Respiration</span><strong>{numberValue(daily, "waking_respiration") === null ? "—" : `${Math.round(numberValue(daily, "waking_respiration")!)} brpm`}</strong><small>Vågen gennemsnit</small><em>Se detaljer ›</em></button>
          </div>
        </section>}

        {deepDive === "sleep" && sleep?.date && <GarminSleepDetail initialDate={String(sleep.date)} onClose={() => setDeepDive(null)} />}
        {deepDive && deepDive !== "sleep" && <GarminHealthDetail metric={deepDive} initialDate={dailyDate} onClose={() => setDeepDive(null)} />}
      </>}
    </section>
  );
}