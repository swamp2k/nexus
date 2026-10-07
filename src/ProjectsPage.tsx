import { useEffect, useMemo, useState } from 'react';
import './projects.css';

type ProjectStatus = 'active' | 'done' | 'retired';
type ResourceKind = 'repo' | 'worker' | 'pages' | 'd1';
type Project = {
  id: string; name: string; description: string; url: string | null; status: ProjectStatus;
  repos: string[]; workers: string[]; pages: string[]; d1: string[]; notes: string | null; updatedAt: string;
};
type DiscoveredResource = { kind: ResourceKind; name: string; meta: Record<string, unknown>; seenAt: string };
type ProjectsOverview = {
  projects: Project[];
  drift: { untracked: DiscoveredResource[]; missing: Array<{ projectId: string; kind: ResourceKind; name: string }>; noCode: string[] };
  counts: Record<ResourceKind, number>;
  lastScanAt: string | null;
  lastScanError: string | null;
};
type Draft = { id: string | null; name: string; description: string; url: string; status: ProjectStatus; repos: string; workers: string; pages: string; d1: string; notes: string };

const FIELD: Record<ResourceKind, 'repos' | 'workers' | 'pages' | 'd1'> = { repo: 'repos', worker: 'workers', pages: 'pages', d1: 'd1' };
const KIND_LABEL: Record<ResourceKind, string> = { repo: 'Repo', worker: 'Worker', pages: 'Pages', d1: 'D1' };
const STATUS_LABEL: Record<ProjectStatus, string> = { active: 'Aktive', done: 'Færdige', retired: 'Pensionerede' };
const IGNORED_ID = 'ignoreret';

function when(value: string | null): string {
  if (!value) return 'aldrig';
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60_000);
  if (minutes < 1) return 'lige nu';
  if (minutes < 60) return `${minutes} min. siden`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} t. siden`;
  return `${Math.round(hours / 24)} d. siden`;
}

function list(value: string): string[] { return value.split(',').map((v) => v.trim()).filter(Boolean); }
function emptyDraft(): Draft { return { id: null, name: '', description: '', url: '', status: 'active', repos: '', workers: '', pages: '', d1: '', notes: '' }; }
function toDraft(p: Project): Draft {
  return { id: p.id, name: p.name, description: p.description, url: p.url ?? '', status: p.status, repos: p.repos.join(', '), workers: p.workers.join(', '), pages: p.pages.join(', '), d1: p.d1.join(', '), notes: p.notes ?? '' };
}
function draftBody(d: Draft) {
  return { name: d.name, description: d.description, url: d.url, status: d.status, repos: list(d.repos), workers: list(d.workers), pages: list(d.pages), d1: list(d.d1), notes: d.notes };
}
function projectBody(p: Project) {
  return { name: p.name, description: p.description, url: p.url, status: p.status, repos: p.repos, workers: p.workers, pages: p.pages, d1: p.d1, notes: p.notes };
}
function shortName(kind: ResourceKind, name: string): string { return kind === 'repo' ? name.split('/').pop() ?? name : name; }

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, ...init });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error === 'exists' ? 'Der findes allerede et projekt med det id.' : `Projekter svarede med HTTP ${response.status}.`);
  }
  return response.json() as Promise<T>;
}

export default function ProjectsPage() {
  const [data, setData] = useState<ProjectsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);

  async function load() {
    try { setData(await api<ProjectsOverview>('/api/projects')); setError(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Projekter kunne ikke hentes.'); }
  }
  useEffect(() => { void load(); }, []);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    try { await action(); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Handlingen fejlede.'); }
    finally { setBusy(false); }
  }

  async function scan() {
    setBusy(true);
    try { setData(await api<ProjectsOverview>('/api/projects/scan', { method: 'POST' })); setError(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Scanningen fejlede.'); }
    finally { setBusy(false); }
  }

  function save(d: Draft) {
    void run(async () => {
      if (d.id) await api(`/api/projects/${encodeURIComponent(d.id)}`, { method: 'PUT', body: JSON.stringify(draftBody(d)) });
      else await api('/api/projects', { method: 'POST', body: JSON.stringify(draftBody(d)) });
      setDraft(null);
    });
  }

  function remove(id: string) {
    if (!window.confirm('Fjern projektet fra oversigten? Intet slettes på GitHub eller Cloudflare.')) return;
    void run(async () => { await api(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }); setDraft(null); });
  }

  function addFromResource(item: DiscoveredResource) {
    const name = shortName(item.kind, item.name);
    setDraft({ ...emptyDraft(), name, [FIELD[item.kind]]: item.name });
  }

  function attach(item: DiscoveredResource, targetId: string) {
    void run(async () => {
      const target = data?.projects.find((p) => p.id === targetId);
      if (target) {
        const field = FIELD[item.kind];
        await api(`/api/projects/${encodeURIComponent(target.id)}`, { method: 'PUT', body: JSON.stringify({ ...projectBody(target), [field]: [...target[field], item.name] }) });
      } else {
        await api('/api/projects', { method: 'POST', body: JSON.stringify({ id: IGNORED_ID, name: 'Ignoreret', description: 'Ressourcer der bevidst ikke hører til et projekt.', status: 'retired', [FIELD[item.kind]]: [item.name] }) });
      }
    });
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const projects = data?.projects ?? [];
    return q ? projects.filter((p) => `${p.name} ${p.description}`.toLowerCase().includes(q)) : projects;
  }, [data, query]);

  const drift = data?.drift;
  const missingByProject = new Map<string, string[]>();
  for (const m of drift?.missing ?? []) missingByProject.set(m.projectId, [...(missingByProject.get(m.projectId) ?? []), `${KIND_LABEL[m.kind]} ${m.name}`]);
  const noCode = new Set(drift?.noCode ?? []);
  const driftParts = drift ? [
    drift.untracked.length && `${drift.untracked.length} ukendte`,
    drift.missing.length && `${drift.missing.length} mangler`,
    drift.noCode.length && `${drift.noCode.length} uden kode`,
  ].filter(Boolean) : [];

  return <section className="projects-page">
    <div className="projects-heading">
      <h2>Projekter</h2>
      <span className="freshness">
        {data && `${data.counts.repo} repos · ${data.counts.worker} workers · ${data.counts.pages} pages · ${data.counts.d1} D1 · `}scannet {when(data?.lastScanAt ?? null)}
      </span>
      <div className="projects-actions">
        <input type="search" placeholder="Søg" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Søg i projekter" />
        <button type="button" onClick={() => setDraft(emptyDraft())} disabled={busy}>Nyt</button>
        <button type="button" onClick={() => void scan()} disabled={busy}>{busy ? 'Arbejder…' : 'Scan nu'}</button>
      </div>
    </div>
    {error && <p className="home-layout-note home-layout-note--error">{error}</p>}
    {data?.lastScanError && <p className="home-layout-note home-layout-note--error">Seneste scanning: {data.lastScanError}. Viser forrige data for de kilder.</p>}
    {!data && !error && <div className="screen-state">Henter projekter…</div>}

    {draft && <ProjectEditor draft={draft} busy={busy} onChange={setDraft} onSave={save} onCancel={() => setDraft(null)} onDelete={draft.id ? () => remove(draft.id!) : undefined} />}

    {drift && driftParts.length > 0 && <details className="projects-drift">
      <summary>{driftParts.join(' · ')}</summary>
      {drift.untracked.length > 0 && <ul className="projects-drift-list">
        {drift.untracked.map((item) => <li key={`${item.kind}:${item.name}`}>
          <span className="projects-chip">{KIND_LABEL[item.kind]}</span><span className="projects-drift-name">{item.name}</span>
          <button type="button" onClick={() => addFromResource(item)} disabled={busy}>Tilføj</button>
          <select value="" disabled={busy} onChange={(e) => attach(item, e.target.value)} aria-label="Ignorér eller knyt til projekt">
            <option value="" disabled>Ignorér…</option>
            <option value={IGNORED_ID}>Ignoreret (pensioneret)</option>
            {data.projects.filter((p) => p.id !== IGNORED_ID).map((p) => <option key={p.id} value={p.id}>Knyt til {p.name}</option>)}
          </select>
        </li>)}
      </ul>}
      {drift.missing.length > 0 && <ul className="projects-drift-list">
        {drift.missing.map((m) => <li key={`${m.projectId}:${m.kind}:${m.name}`}><span className="projects-chip projects-chip--warn">Mangler</span><span className="projects-drift-name">{KIND_LABEL[m.kind]} {m.name}</span><span className="projects-muted">i {m.projectId}</span></li>)}
      </ul>}
      {drift.noCode.length > 0 && <ul className="projects-drift-list">
        {drift.noCode.map((id) => <li key={id}><span className="projects-chip projects-chip--warn">Uden kode</span><span className="projects-drift-name">{id}</span><span className="projects-muted">har Cloudflare-ressourcer men intet repo</span></li>)}
      </ul>}
    </details>}

    {data && (['active', 'done', 'retired'] as ProjectStatus[]).map((status) => {
      const rows = filtered.filter((p) => p.status === status);
      if (!rows.length) return null;
      const body = <ul className="projects-list">{rows.map((p) => <li key={p.id} className="projects-row">
        <div className="projects-row-main">
          <button type="button" className="projects-name" onClick={() => setDraft(toDraft(p))} title="Redigér">{p.name}</button>
          <span className="projects-desc">{p.description}</span>
          {(missingByProject.has(p.id) || noCode.has(p.id)) && <span className="projects-flag" title={[...(missingByProject.get(p.id) ?? []), ...(noCode.has(p.id) ? ['Intet repo'] : [])].join(', ')}>!</span>}
        </div>
        <div className="projects-row-links">
          {p.url && <a href={p.url} target="_blank" rel="noreferrer">Site</a>}
          {p.repos.map((r) => <a key={r} href={`https://github.com/${r}`} target="_blank" rel="noreferrer">{shortName('repo', r)}</a>)}
          {p.workers.map((n) => <span key={`w${n}`} className="projects-chip">W {n}</span>)}
          {p.pages.map((n) => <span key={`p${n}`} className="projects-chip">P {n}</span>)}
          {p.d1.map((n) => <span key={`d${n}`} className="projects-chip">D1 {n}</span>)}
        </div>
      </li>)}</ul>;
      return status === 'retired'
        ? <details key={status} className="projects-group"><summary>{STATUS_LABEL[status]} ({rows.length})</summary>{body}</details>
        : <section key={status} className="projects-group"><h3>{STATUS_LABEL[status]} ({rows.length})</h3>{body}</section>;
    })}
  </section>;
}

function ProjectEditor({ draft, busy, onChange, onSave, onCancel, onDelete }: {
  draft: Draft; busy: boolean; onChange: (d: Draft) => void; onSave: (d: Draft) => void; onCancel: () => void; onDelete?: () => void;
}) {
  const field = (key: keyof Draft, label: string, placeholder = '') => <label>
    <span>{label}</span>
    <input value={draft[key] ?? ''} placeholder={placeholder} onChange={(e) => onChange({ ...draft, [key]: e.target.value })} />
  </label>;
  return <form className="projects-editor" onSubmit={(e) => { e.preventDefault(); onSave(draft); }}>
    {field('name', 'Navn')}
    {field('description', 'Beskrivelse')}
    {field('url', 'Live URL', 'https://')}
    <label><span>Status</span>
      <select value={draft.status} onChange={(e) => onChange({ ...draft, status: e.target.value as ProjectStatus })}>
        <option value="active">Aktiv</option><option value="done">Færdig</option><option value="retired">Pensioneret</option>
      </select>
    </label>
    {field('repos', 'Repos', 'swamp2k/navn, …')}
    {field('workers', 'Workers', 'kommasepareret')}
    {field('pages', 'Pages', 'kommasepareret')}
    {field('d1', 'D1', 'kommasepareret')}
    <label className="projects-editor-wide"><span>Noter</span><input value={draft.notes} onChange={(e) => onChange({ ...draft, notes: e.target.value })} /></label>
    <div className="projects-editor-actions">
      {onDelete && <button type="button" className="projects-danger" onClick={onDelete} disabled={busy}>Fjern</button>}
      <button type="button" onClick={onCancel} disabled={busy}>Annullér</button>
      <button type="submit" disabled={busy || !draft.name.trim()}>Gem</button>
    </div>
  </form>;
}
