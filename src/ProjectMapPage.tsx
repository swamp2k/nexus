import { Component, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

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
  liveRefreshReady: boolean;
  missingSetup: string[];
  refreshError?: string;
};

type Filter = "all" | "attention" | "deployed" | "repo-only";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeProject(value: unknown, index: number): Project | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === "string" && value.id.trim() ? value.id : `project-${index + 1}`;
  return {
    id,
    title: typeof value.title === "string" && value.title.trim() ? value.title : id,
    repo: typeof value.repo === "string" && value.repo.trim() ? value.repo : null,
    workers: strings(value.workers),
    pages: strings(value.pages),
    domains: strings(value.domains),
    status: typeof value.status === "string" ? value.status : "unknown",
    warnings: strings(value.warnings),
  };
}

function normalizeData(value: unknown): ProjectMapData | null {
  if (!isRecord(value)) return null;
  const summary = isRecord(value.summary) ? value.summary : {};
  const projects = Array.isArray(value.projects)
    ? value.projects.map(normalizeProject).filter((project): project is Project => project !== null)
    : [];

  return {
    generatedAt: typeof value.generatedAt === "string" ? value.generatedAt : "",
    source: typeof value.source === "string" ? value.source : "unknown",
    summary: {
      githubRepos: typeof summary.githubRepos === "number" ? summary.githubRepos : 0,
      workers: typeof summary.workers === "number" ? summary.workers : 0,
      pages: typeof summary.pages === "number" ? summary.pages : 0,
    },
    projects,
    repoOnly: strings(value.repoOnly),
    archivedRepoOnly: strings(value.archivedRepoOnly),
    liveRefreshReady: value.liveRefreshReady === true,
    missingSetup: strings(value.missingSetup),
    refreshError: typeof value.refreshError === "string" ? value.refreshError : undefined,
  };
}

function snapshotTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "ukendt tidspunkt" : parsed.toLocaleString("da-DK");
}

function Node({ kind, children }: { kind: string; children: ReactNode }) {
  return <span className={`project-node project-node--${kind}`}>{children}</span>;
}

class ProjectMapBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("Project Map render failed", error);
  }

  render() {
    if (this.state.failed) {
      return <section className="placeholder-card">
        <p className="section-label">Project Map</p>
        <h2>Projektkortet kunne ikke vises</h2>
        <p>Resten af Nexus kører videre. Genindlæs siden eller prøv Project Map igen.</p>
      </section>;
    }
    return this.props.children;
  }
}

function ProjectMapContent() {
  const [data, setData] = useState<ProjectMapData | null>(null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");

  async function load(method: "GET" | "POST" = "GET") {
    if (method === "POST") setRefreshing(true);
    try {
      const response = await fetch("/api/project-map", { method, credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error("project_map_failed");
      const normalized = normalizeData(await response.json());
      if (!normalized) throw new Error("invalid_project_map_data");
      setData(normalized);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const attentionCount = useMemo(
    () => data?.projects.filter((project) => project.warnings.length > 0).length ?? 0,
    [data],
  );

  const visibleProjects = useMemo(() => {
    if (!data) return [];
    if (filter === "attention") return data.projects.filter((project) => project.warnings.length > 0);
    if (filter === "deployed") return data.projects.filter((project) => project.workers.length > 0 || project.pages.length > 0);
    if (filter === "repo-only") return [];
    return data.projects;
  }, [data, filter]);

  if (error && !data) {
    return <section className="placeholder-card">
      <p className="section-label">Project Map</p>
      <h2>Projektkortet kunne ikke hentes</h2>
      <p>Resten af Nexus er ikke påvirket.</p>
      <button className="secondary-action" type="button" onClick={() => void load()}>Prøv igen</button>
    </section>;
  }
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
      Live-opdatering er ikke konfigureret. Viser den private snapshot fra {snapshotTime(data.generatedAt)}.
      Credentials kan tilføjes under Indstillinger → Project Map.
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

export default function ProjectMapPage() {
  return <ProjectMapBoundary><ProjectMapContent /></ProjectMapBoundary>;
}
