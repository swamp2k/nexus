import { useEffect, useState } from 'react';
import './pcwatch.css';

type PrivateeringTorrent = { hash: string; name: string; sizeBytes: number; completed: boolean; progressPct: number; addedAt: string | null };
type PrivateeringFile = { path: string; sizeBytes: number; status: string; committedAt: string | null };
type PrivateeringOverview = { fetchedAt: string | null; torrents: PrivateeringTorrent[]; copyarrFiles: PrivateeringFile[] };

function when(value: string | null): string {
  if (!value) return 'aldrig';
  const diffMs = Date.now() - new Date(value).getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return 'lige nu';
  if (minutes < 60) return `${minutes} min. siden`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} t. siden`;
  return `${Math.round(hours / 24)} dage siden`;
}

function size(bytes: number): string {
  if (bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes, index = 0;
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index++; }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[index]}`;
}

export default function PrivateeringPage() {
  const [data, setData] = useState<PrivateeringOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const response = await fetch('/api/privateering/overview', { credentials: 'same-origin', cache: 'no-store' });
        if (!response.ok) throw new Error(`Privateering svarede med HTTP ${response.status}.`);
        const next = await response.json() as PrivateeringOverview;
        if (active) { setData(next); setError(null); }
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : 'Privateering kunne ikke hentes.'); }
      finally { if (active) setLoading(false); }
    }
    void load();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  return <section className="pcwatch-page">
    <div className="pcwatch-page-heading">
      <div><p className="section-label">Privateering</p><h2>Torrents og overførsler</h2><p>rTorrent og Copyarr · opdateres hvert minut.</p></div>
      {data?.fetchedAt && <span className="freshness">Hentet {when(data.fetchedAt)}</span>}
    </div>
    {loading && !data && <div className="screen-state">Henter Privateering…</div>}
    {error && <p className="home-layout-note home-layout-note--error">{error}{data && ' Viser seneste data.'}</p>}
    {!loading && !error && !data?.fetchedAt && <p>Der er endnu ikke modtaget data fra rTorrent/Copyarr-agenten.</p>}
    {data && data.fetchedAt && <>
      <section className="pcwatch-page-section">
        <h3>Seneste torrents</h3>
        {data.torrents.length === 0 && <p>Ingen torrents rapporteret.</p>}
        <div className="pcwatch-page-list">
          {data.torrents.map((t) => <article key={t.hash}>
            <div><strong>{t.name}</strong><small>{size(t.sizeBytes)} · tilføjet {when(t.addedAt)}</small></div>
            <span className={t.completed ? 'pcwatch-good' : 'pcwatch-warn'}>{t.completed ? 'Fuldført' : `${Math.round(t.progressPct)}%`}</span>
          </article>)}
        </div>
      </section>
      <section className="pcwatch-page-section">
        <h3>Copyarr-overførsler</h3>
        {data.copyarrFiles.length === 0 && <p>Ingen filer rapporteret.</p>}
        <div className="pcwatch-page-list">
          {data.copyarrFiles.map((f) => <article key={f.path}>
            <div><strong>{f.path}</strong><small>{size(f.sizeBytes)} · {f.committedAt ? `lagt til ${when(f.committedAt)}` : 'afventer'}</small></div>
            <span className={f.status === 'done' ? 'pcwatch-good' : 'pcwatch-warn'}>{f.status}</span>
          </article>)}
        </div>
      </section>
    </>}
  </section>;
}
