import { useEffect, useMemo, useState } from "react";

type Project = {
  id: string;
  title: string;
  repo: string | null;
  workers: string[];
  pages: string[];
  domains: string[];
  status: string;
  warnings: string[];
};

type ProjectMapData = {
  generatedAt: string;
  source: string;
  summary: { githubRepos: number; workers: number; pages: number };
  projects: Project[];
  repoOnly: string[];
  archivedRepoOnly: string[];
  liveRefreshReady?: boolean;
  missingSetup?: string[];
  refreshError?: string;
};

type Filter = "all" | "attention" | "deployed" | "repo-only";

function Node({ kind, children }: { kind: string; children: React.ReactNode }) {
  return <span className={`project-node project-node--${kind}`}>{children}</span>;
}

export default function ProjectMapPage() {
  const [data, setData] = useState<ProjectMapData | null>(null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");

  async function load(method: "GET" | "POST" = "GET") {
    if (method === "POST") setRefreshing(true);
    try {
      const response = await fetch("/api/project-map", { method, credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error("project_map_failed");
      setData(await response.json() as ProjectMapData);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const attentionCount = useMemo(() => data?.projects.filter((project) => project.warnings.length > 0).length ?? 0, [data]);
  const visibleProjects = useMemo(() => {
    if (!data) return [];
    if (filter === "attention") return data.projects.filter((project) => project.warnings.length > 0);
    if (filter === "deployed") return data.projects.filter((project) => project.workers.length > 0 || project.pages.length > 0);
    if (filter === "repo-only") return [];
    return data.projects;
  }, [data, filter]);

  if (error && !data) return <p className="screen-state">Projektkortet kunne ikke hentes.</p>;
  if (!data) return <p className="screen-state">Henter projektkort…</p>;

  return <div className="project-map-page">
    <div className="project-map-toolbar">
      <div className="project-map-summary">
        <span><strong>{data.summary.githubRepos}</strong><small>GitHub repos</small></span>
        <span><strong>{data.summary.workers}</strong><small>Workers</small></span>
        <span><strong>{data.summary.pages}</strong><small>Pages</small></span>
        <span className={attentionCount ? "has-warning" : ""}><strong>{attentionCount}</strong><small>Kræver blik</small></span>
      </div>
      <button type="button" className="secondary-action" disabled={refreshing || !data.liveRefreshReady} onClick={() => void load("POST")}>
        {refreshing ? "Opdaterer…" : "Opdater fra GitHub + Cloudflare"}
      </button>
    </div>

    {!data.liveRefreshReady && <div className="project-map-notice">
      Live-opdatering mangler {data.missingSetup?.join(", ")}. Viser den private snapshot fra {new Date(data.generatedAt).toLocaleString("da-DK")}.
    </div>}
    {data.refreshError && <div className="project-map-notice project-map-notice--warning">Live-opdatering fejlede. Viser seneste kendte snapshot.</div>}

    <div className="project-map-filters" role="group" aria-label="Filtrer projekter">
      {(["all", "attention", "deployed", "repo-only"] as Filter[]).map((value) =>
        <button key={value} type="button" className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>
          {value === "all" ? "Alle" : value === "attention" ? "Kræver blik" : value === "deployed" ? "Deployet" : "Kun GitHub"}
        </button>
      )}
    </div>

    {filter === "repo-only" ? <section className="project-repo-only">
      <div><p className="section-label">Ikke koblet til Cloudflare</p>{data.repoOnly.map((repo) => <Node key={repo} kind="repo">{repo}</Node>)}</div>
      {data.archivedRepoOnly.length > 0 && <div><p className="section-label">Arkiverede repos</p>{data.archivedRepoOnly.map((repo) => <Node key={repo} kind="muted">{repo}</Node>)}</div>}
    </section> : <div className="project-map-grid">
      {visibleProjects.map((project) => <article className={`project-map-card${project.warnings.length ? " project-map-card--warning" : ""}`} key={project.id}>
        <header><div><h3>{project.title}</h3><small>{project.status === "unmapped" ? "Unmapped" : project.status}</small></div>{project.warnings.length > 0 && <span className="project-warning-count">{project.warnings.length}</span>}</header>
        <div className="project-flow">
          <Node kind="project">{project.id}</Node>
          {project.repo && <><span className="project-arrow">→</span><Node kind="repo">{project.repo}</Node></>}
          {project.workers.map((worker) => <span className="project-flow-step" key={worker}><span className="project-arrow">→</span><Node kind="worker">{worker}</Node></span>)}
          {project.pages.map((page) => <span className="project-flow-step" key={page}><span className="project-arrow">→</span><Node kind="pages">{page}</Node></span>)}
          {project.domains.map((domain) => <span className="project-flow-step" key={domain}><span className="project-arrow">→</span><Node kind="domain">{domain}</Node></span>)}
        </div>
        {project.warnings.length > 0 && <ul className="project-warnings">{project.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
      </article>)}
    </div>}
  </div>;
}
