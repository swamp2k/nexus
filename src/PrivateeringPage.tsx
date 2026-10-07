import { useEffect, useState } from 'react';
import './privateering.css';

type PrivateeringTorrent = { hash: string; name: string; sizeBytes: number; completed: boolean; progressPct: number; addedAt: string | null };
type PrivateeringFile = { path: string; sizeBytes: number; status: string; committedAt: string | null };
type PrivateeringOverview = { fetchedAt: string | null; torrents: PrivateeringTorrent[]; copyarrFiles: PrivateeringFile[] };

function when(value: string | null): string {
  if (!value) return '—';
  const diffMs = Date.now() - new Date(value).getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return 'lige nu';
  if (minutes < 60) return `${minutes} min.`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} t.`;
  return `${Math.round(hours / 24)} d.`;
}

function size(bytes: number): string {
  if (bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes, index = 0;
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index++; }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[index]}`;
}

function splitPath(path: string): { folder: string; base: string } {
  const idx = path.lastIndexOf('/');
  if (idx === -1) return { folder: '', base: path };
  return { folder: path.slice(0, idx), base: path.slice(idx + 1) };
}

const COPYARR_LABEL: Record<string, string> = {
  done: 'Færdig', copying: 'Kopierer', queued: 'I kø', discovered: 'Fundet', failed: 'Fejl', error: 'Fejl',
};
const COPYARR_PILL: Record<string, string> = {
  done: 'privateering-pill--done', copying: 'privateering-pill--progress', queued: 'privateering-pill--queued',
  discovered: 'privateering-pill--queued', failed: 'privateering-pill--error', error: 'privateering-pill--error',
};

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

  return <section className="privateering-page">
    <div className="privateering-page-heading">
      <h2>Privateering</h2>
      <span className="freshness">rTorrent · Copyarr · hentet {data?.fetchedAt ? when(data.fetchedAt) : '—'}</span>
    </div>
    {loading && !data && <div className="screen-state">Henter Privateering…</div>}
    {error && <p className="home-layout-note home-layout-note--error">{error}{data && ' Viser seneste data.'}</p>}
    {!loading && !error && !data?.fetchedAt && <p>Der er endnu ikke modtaget data fra rTorrent/Copyarr-agenten.</p>}
    {data && data.fetchedAt && <div className="privateering-grid">
      <section className="privateering-section">
        <h3>Seneste torrents</h3>
        {data.torrents.length === 0 && <p>Ingen torrents rapporteret.</p>}
        {data.torrents.length > 0 && <table className="privateering-table">
          <colgroup><col /><col style={{ width: '64px' }} /><col style={{ width: '90px' }} /><col style={{ width: '54px' }} /></colgroup>
          <thead><tr><th>Navn</th><th className="num">Størrelse</th><th className="num">Fremskridt</th><th className="num col-optional">Tilføjet</th></tr></thead>
          <tbody>{data.torrents.map((t) => <tr key={t.hash}>
            <td className="name-cell" title={t.name}>{t.name}</td>
            <td className="num">{size(t.sizeBytes)}</td>
            <td className="num">
              {t.completed ? <span className="privateering-progress-done">✓</span> : <span className="privateering-progress">
                <span className="privateering-progress-bar"><span style={{ width: `${Math.round(t.progressPct)}%` }} /></span>
                <span className="privateering-progress-pct">{Math.round(t.progressPct)}%</span>
              </span>}
            </td>
            <td className="num col-optional">{when(t.addedAt)}</td>
          </tr>)}</tbody>
        </table>}
      </section>
      <section className="privateering-section">
        <h3>Copyarr-overførsler</h3>
        {data.copyarrFiles.length === 0 && <p>Ingen filer rapporteret.</p>}
        {data.copyarrFiles.length > 0 && <table className="privateering-table">
          <colgroup><col /><col style={{ width: '64px' }} /><col style={{ width: '64px' }} /><col style={{ width: '54px' }} /></colgroup>
          <thead><tr><th>Fil</th><th className="num">Størrelse</th><th>Status</th><th className="num col-optional">Tid</th></tr></thead>
          <tbody>{data.copyarrFiles.map((f) => {
            const { folder, base } = splitPath(f.path);
            return <tr key={f.path}>
              <td className="name-cell" title={f.path}>{folder && <span className="name-folder">{folder}/</span>}{base}</td>
              <td className="num">{size(f.sizeBytes)}</td>
              <td><span className={`privateering-pill ${COPYARR_PILL[f.status] ?? 'privateering-pill--queued'}`}>{COPYARR_LABEL[f.status] ?? f.status}</span></td>
              <td className="num col-optional">{when(f.committedAt)}</td>
            </tr>;
          })}</tbody>
        </table>}
      </section>
    </div>}
  </section>;
}
