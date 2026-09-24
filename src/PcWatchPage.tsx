import { useEffect, useState } from 'react';
import { pcWatchOverviewUrl, recent, when, type PcWatchOverview } from './widgets/pcwatchWidgets';
import './pcwatch.css';

function status(status: string | null): string {
  return status === 'success' ? 'Gennemført' : status === 'failure' ? 'Fejlede' : status === 'running' ? 'Kører' : status === 'pending' ? 'Afventer' : 'Ingen kørsel';
}

export default function PcWatchPage() {
  const [data, setData] = useState<PcWatchOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const response = await fetch(pcWatchOverviewUrl, { credentials: 'same-origin', cache: 'no-store' });
        if (response.status === 403) { if (active) setData(null); throw new Error('Du har ikke adgang til PC Watch.'); }
        if (!response.ok) throw new Error(response.status === 503 ? 'Forbindelsen til PC Watch er ikke konfigureret.' : `PC Watch svarede med HTTP ${response.status}.`);
        const next = await response.json() as PcWatchOverview;
        if (active) { setData(next); setError(null); }
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : 'PC Watch kunne ikke hentes.'); }
      finally { if (active) setLoading(false); }
    }
    void load();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  return <section className="pcwatch-page">
    <div className="pcwatch-page-heading"><div><p className="section-label">PC Watch</p><h2>PC'er og backup</h2><p>Fælles status fra PC Watch · opdateres hvert minut.</p></div>{data && <span className="freshness">Hentet {when(data.fetchedAt)}</span>}</div>
    {loading && !data && <div className="screen-state">Henter PC Watch…</div>}
    {error && <p className="home-layout-note home-layout-note--error">{error}{data && ' Viser seneste data.'}</p>}
    {data && <>
      <div className="pcwatch-page-summary"><div><strong>{data.devices.filter(d => recent(d.metricsAt, 120)).length}/{data.devices.length}</strong><span>PC'er rapporterer</span></div><div><strong>{data.alerts.length}</strong><span>aktive alarmer</span></div><div><strong>{data.backupTasks.filter(t => t.enabled).length}</strong><span>cloud backups</span></div><div><strong>{data.backupAgents.filter(a => a.status === 'active' && recent(a.lastSeenAt, 2)).length}/{data.backupAgents.length}</strong><span>backup-agenter online</span></div></div>
      <section className="pcwatch-page-section"><h3>PC'er</h3>{data.devices.length === 0 && <p>Ingen PC'er registreret.</p>}<div className="pcwatch-page-list">{data.devices.map(d => <article key={d.id}><div><strong>{d.name}</strong><small>{d.owner ?? 'PC'} · sidst {when(d.metricsAt)}</small></div><span className={recent(d.metricsAt, 120) ? 'pcwatch-good' : 'pcwatch-warn'}>{recent(d.metricsAt, 120) ? 'Rapporterer' : 'Ingen nylig rapport'}</span><small>CPU {d.cpuPct === null ? '—' : `${Math.round(d.cpuPct)}%`} · RAM {d.ramPct === null ? '—' : `${Math.round(d.ramPct)}%`} · {d.openAlerts} alarmer</small></article>)}</div></section>
      <section className="pcwatch-page-section"><h3>Cloud backup</h3>{data.backupTasks.length === 0 && <p>Ingen cloud backup-opgaver.</p>}<div className="pcwatch-page-list">{data.backupTasks.map(t => <article key={t.id}><div><strong>{t.name}</strong><small>{t.remote ?? 'Kilde ukendt'} · {t.agentName}</small></div><span className={t.lastRunStatus === 'failure' ? 'pcwatch-warn' : 'pcwatch-good'}>{t.enabled ? status(t.lastRunStatus) : 'Deaktiveret'}</span><small>Sidst lykkedes {when(t.lastSuccessAt)} · næste {when(t.nextDueAt)}{t.lastRunStatus === 'running' && t.lastRunProgressPct !== null ? ` · ${Math.round(t.lastRunProgressPct)}%` : ''}</small>{t.lastRunError && <small className="pcwatch-warn">{t.lastRunError}</small>}</article>)}</div></section>
      <section className="pcwatch-page-section"><h3>Backup-agenter</h3>{data.backupAgents.length === 0 && <p>Ingen backup-agenter.</p>}<div className="pcwatch-page-list">{data.backupAgents.map(a => <article key={a.id}><div><strong>{a.name}</strong><small>Version {a.version ?? 'ukendt'} · sidst set {when(a.lastSeenAt)}</small></div><span className={a.status === 'active' && recent(a.lastSeenAt, 2) ? 'pcwatch-good' : 'pcwatch-warn'}>{a.status === 'active' && recent(a.lastSeenAt, 2) ? 'Online' : 'Ingen nylig kontakt'}</span><small>{a.remotes.join(', ') || 'Ingen remotes rapporteret'}</small></article>)}</div></section>
      <section className="pcwatch-page-section"><h3>PC-backup</h3>{data.deviceBackups.length === 0 && <p>Ingen PC-backups konfigureret.</p>}<div className="pcwatch-page-list">{data.deviceBackups.map(b => <article key={b.deviceId}><div><strong>{b.deviceName}</strong><small>{b.destinationName ?? 'Destination ukendt'}</small></div><span className={b.lastStatus === 'failure' ? 'pcwatch-warn' : 'pcwatch-good'}>{status(b.lastStatus)}</span><small>Senest {when(b.lastAt)} · næste {when(b.nextDueAt)}</small></article>)}</div></section>
      <section className="pcwatch-page-section"><h3>Aktive alarmer</h3>{data.alerts.length === 0 && <p>Ingen aktive alarmer.</p>}<div className="pcwatch-page-list">{data.alerts.map(a => <article key={a.id}><div><strong>{a.deviceName}</strong><small>{a.message ?? a.type}</small></div><small>{when(a.triggeredAt)}</small></article>)}</div></section>
    </>}
  </section>;
}
