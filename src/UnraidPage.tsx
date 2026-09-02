import { useEffect, useMemo, useState } from "react";
import UnraidSettings from "./UnraidSettings";

type UnraidStats = { cpuPct: number; ramPct: number; ramUsedGb: number; ramTotalGb: number; uptimeS: number; tempAvg: number | null };
type UnraidDisk = { slot: string; name: string; temp: number | null; health: string; usedGb: number; totalGb: number };
type UnraidArray = { status: string; capacityUsedTb: number; capacityTotalTb: number; disks: UnraidDisk[]; cache: UnraidDisk[] };
type UnraidContainer = { id: string; name: string; status: string };
type UnraidVM = { id: string; name: string; status: string };
type UnraidShare = { name: string; usedGb: number; totalGb: number; pct: number };
type UnraidUPS = { model: string; status: string; batteryPct: number; runtimeMin: number; loadPct: number };
// Mirrors the UnraidWatch integration contract v1. Nexus renders these as-is;
// all Unraid-specific normalization happens in UnraidWatch.
type Overview = {
  contractVersion: number; fetchedAt: string; server: { label: string; online: boolean }; stats: UnraidStats;
  array: UnraidArray; containers: UnraidContainer[]; vms: UnraidVM[]; shares: UnraidShare[]; ups: UnraidUPS | null;
};

type Tab = "Overblik" | "Docker" | "VM'er" | "Shares" | "UPS" | "Forbindelse";

function uptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  return days > 0 ? `${days} d ${hours} t` : `${hours} t`;
}

function statusTone(value: string): string {
  const normalized = value.toLowerCase();
  return normalized.includes("run") || normalized.includes("normal") || normalized.includes("online") || normalized.includes("started") ? "ok" : "warn";
}

export default function UnraidPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "unconfigured" | "error">("loading");
  const [tab, setTab] = useState<Tab>("Overblik");
  const [lastError, setLastError] = useState<string | null>(null);
  const [setupReason, setSetupReason] = useState<string | null>(null);

  async function refresh(showLoading = false) {
    if (showLoading) setState("loading");
    try {
      const response = await fetch("/api/unraid/overview", { credentials: "same-origin", cache: "no-store" });
      if (response.status === 409) {
        const reason = await response.json().catch(() => ({})) as { error?: string };
        setSetupReason(reason.error ?? null); setState("unconfigured"); return;
      }
      const body = await response.json().catch(() => ({})) as Overview & { error?: string };
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      setData(body); setState("ready"); setLastError(null);
    } catch (error) {
      setLastError(error instanceof Error ? error.message : "unraid_fetch_failed");
      if (showLoading) setState("error");
    }
  }

  useEffect(() => {
    void refresh(true);
    const timer = window.setInterval(() => { if (document.visibilityState === "visible" && tab !== "Forbindelse") void refresh(false); }, 30_000);
    const visible = () => { if (document.visibilityState === "visible" && tab !== "Forbindelse") void refresh(false); };
    document.addEventListener("visibilitychange", visible);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [tab]);

  const runningContainers = useMemo(() => data?.containers.filter((item) => statusTone(item.status) === "ok").length ?? 0, [data]);
  const runningVMs = useMemo(() => data?.vms.filter((item) => statusTone(item.status) === "ok").length ?? 0, [data]);

  if (state === "loading") return <section className="unraid-page"><div className="screen-state">Henter Unraid…</div></section>;
  if (state === "unconfigured") return <section className="unraid-page"><div className="unraid-toolbar"><div><p className="section-label">Unraid Watch</p><h2>Forbind til UnraidWatch</h2><p>{setupReason === "unraidwatch_server_not_configured" ? "UnraidWatch-kontoen har endnu ingen Unraid-server gemt. Tilføj den i UnraidWatch først." : "Nexus henter Unraid-data fra UnraidWatch. Indsæt et integrations-token for at komme i gang."}</p></div></div><section className="settings-card"><UnraidSettings /></section><p className="settings-help">Når forbindelsen er gemt, genindlæs Unraid-fanen. Nexus tester tokenet mod UnraidWatch før det gemmes.</p></section>;
  if (state === "error" || !data) return <section className="unraid-page"><div className="placeholder-card"><p className="section-label">Unraid Watch</p><h2>Data kunne ikke hentes fra UnraidWatch</h2><p>{lastError ?? "Ukendt fejl"}</p><div className="settings-location-actions"><button className="primary-action" type="button" onClick={() => void refresh(true)}>Prøv igen</button><button className="secondary-action" type="button" onClick={() => setTab("Forbindelse")}>Forbindelse</button></div></div>{tab === "Forbindelse" && <section className="settings-card"><UnraidSettings /></section>}</section>;

  return <section className="unraid-page">
    <div className="unraid-toolbar">
      <div><p className="section-label">Unraid Watch</p><h2>{data.server.label}</h2><p>Live status via UnraidWatch · opdateres hvert 30. sekund mens fanen er synlig.{data.server.online ? "" : " · UnraidWatch melder serveren offline."}</p></div>
      <div className="unraid-toolbar-actions"><span className="freshness">{new Date(data.fetchedAt).toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span><button className="secondary-action" type="button" onClick={() => void refresh(false)}>Opdater</button></div>
    </div>

    <nav className="unraid-tabs" aria-label="Unraid sektioner">{(["Overblik", "Docker", "VM'er", "Shares", "UPS", "Forbindelse"] as Tab[]).map((item) => <button type="button" className={tab === item ? "active" : ""} key={item} onClick={() => setTab(item)}>{item}</button>)}</nav>

    {lastError && <p className="home-layout-note home-layout-note--error">Seneste opdatering fejlede: {lastError}. Viser seneste data.</p>}

    {tab === "Overblik" && <>
      <div className="unraid-stat-grid">
        <article className="unraid-stat"><span>CPU</span><strong>{data.stats.cpuPct.toFixed(1)}%</strong><small>{data.stats.tempAvg === null ? "Temperatur ukendt" : `${data.stats.tempAvg}°C gennemsnit`}</small></article>
        <article className="unraid-stat"><span>RAM</span><strong>{data.stats.ramPct.toFixed(1)}%</strong><small>{data.stats.ramUsedGb.toFixed(1)} / {data.stats.ramTotalGb.toFixed(1)} GB</small></article>
        <article className="unraid-stat"><span>Array</span><strong>{data.array.capacityUsedTb.toFixed(1)} TB</strong><small>af {data.array.capacityTotalTb.toFixed(1)} TB · {data.array.status}</small></article>
        <article className="unraid-stat"><span>Uptime</span><strong>{uptime(data.stats.uptimeS)}</strong><small>{runningContainers}/{data.containers.length} containere · {runningVMs}/{data.vms.length} VM'er</small></article>
      </div>
      <section className="unraid-panel"><div className="unraid-panel-heading"><div><p className="section-label">Array</p><h3>Diske og cache</h3></div><span className={`unraid-status ${statusTone(data.array.status)}`}>{data.array.status}</span></div>
        <div className="unraid-disk-grid">{[...data.array.disks, ...data.array.cache].map((disk) => <article className="unraid-disk" key={`${disk.slot}:${disk.name}`}><div><strong>{disk.name}</strong><span>{disk.slot}</span></div><b>{disk.temp === null ? "—" : `${disk.temp}°C`}</b><small>{disk.usedGb.toLocaleString("da-DK")} / {disk.totalGb.toLocaleString("da-DK")} GB · {disk.health}</small></article>)}</div>
      </section>
    </>}

    {tab === "Docker" && <section className="unraid-panel"><div className="unraid-panel-heading"><div><p className="section-label">Docker</p><h3>{runningContainers} af {data.containers.length} kører</h3></div></div><div className="unraid-list">{data.containers.map((item) => <div className="unraid-row" key={item.id}><strong>{item.name}</strong><span className={`unraid-status ${statusTone(item.status)}`}>{item.status}</span></div>)}</div></section>}
    {tab === "VM'er" && <section className="unraid-panel"><div className="unraid-panel-heading"><div><p className="section-label">Virtuelle maskiner</p><h3>{runningVMs} af {data.vms.length} kører</h3></div></div><div className="unraid-list">{data.vms.length ? data.vms.map((item) => <div className="unraid-row" key={item.id}><strong>{item.name}</strong><span className={`unraid-status ${statusTone(item.status)}`}>{item.status}</span></div>) : <p className="settings-help">Ingen VM'er fundet.</p>}</div></section>}
    {tab === "Shares" && <section className="unraid-panel"><div className="unraid-panel-heading"><div><p className="section-label">Shares</p><h3>Lagerforbrug</h3></div></div><div className="unraid-share-list">{data.shares.map((share) => <div className="unraid-share" key={share.name}><div><strong>{share.name}</strong><span>{share.usedGb.toLocaleString("da-DK")} / {share.totalGb.toLocaleString("da-DK")} GB</span></div><div className="unraid-progress"><span style={{ width: `${Math.max(0, Math.min(100, share.pct))}%` }} /></div><b>{share.pct}%</b></div>)}</div></section>}
    {tab === "UPS" && <section className="unraid-panel"><div className="unraid-panel-heading"><div><p className="section-label">UPS</p><h3>{data.ups?.model ?? "Ingen UPS fundet"}</h3></div>{data.ups && <span className={`unraid-status ${statusTone(data.ups.status)}`}>{data.ups.status}</span>}</div>{data.ups && <div className="unraid-stat-grid unraid-stat-grid--three"><article className="unraid-stat"><span>Batteri</span><strong>{data.ups.batteryPct}%</strong></article><article className="unraid-stat"><span>Runtime</span><strong>{Math.round(data.ups.runtimeMin)} min</strong></article><article className="unraid-stat"><span>Load</span><strong>{data.ups.loadPct}%</strong></article></div>}</section>}
    {tab === "Forbindelse" && <section className="settings-card"><UnraidSettings /></section>}
  </section>;
}
