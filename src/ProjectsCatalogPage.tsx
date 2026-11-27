import { useCallback, useEffect, useMemo, useState } from "react";
import ProjectMapEditor from "./ProjectMapEditor";
import type { EditableProject, EditorPrefill, RegistryEntry, RepoMeta, ResourceInventory } from "./ProjectMapEditor";

type Project = EditableProject & {
  status: string;
  warnings: string[];
};

type ProjectMapData = {
  generatedAt: string;
  projects: Project[];
  repoOnly: string[];
  archivedRepoOnly: string[];
  liveRefreshReady: boolean;
  registry: RegistryEntry[];
  inventory: ResourceInventory;
  workerPublicUrls: Record<string, string[]>;
  repoMeta?: Record<string, RepoMeta>;
};

type RepoBoardRepo = {
  name: string;
  resumePrompt: string;
};

type RepoBoardLane = {
  id: string;
  title: string;
  repos: RepoBoardRepo[];
};

type RepoBoardData = {
  lanes: RepoBoardLane[];
};

type Filter = "all" | "public" | "web" | "desktop" | "hidden";

function safeUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const raw = value.trim();
  if (!raw) return null;
  const candidate = raw.includes("://") ? raw : `https://${raw}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "https:" || !parsed.hostname.includes(".") || parsed.username || parsed.password) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function repoShortName(fullName: string): string {
  const idx = fullName.indexOf("/");
  return idx >= 0 ? fullName.slice(idx + 1) : fullName;
}

function titleFromRepo(fullName: string): string {
  return repoShortName(fullName).replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function ProjectsCatalogPage() {
  const [data, setData] = useState<ProjectMapData | null>(null);
  const [board, setBoard] = useState<RepoBoardData | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [prefill, setPrefill] = useState<EditorPrefill | null>(null);

  const load = useCallback(async (method: "GET" | "POST" = "GET") => {
    setError("");
    if (method === "POST") setRefreshing(true);
    try {
      const [mapRes, boardRes] = await Promise.all([
        fetch("/api/project-map", { method, credentials: "same-origin", cache: "no-store" }),
        method === "GET"
          ? fetch("/api/repo-board/board", { credentials: "same-origin", cache: "no-store" }).catch(() => null)
          : Promise.resolve(null),
      ]);
      if (!mapRes.ok) throw new Error("Kunne ikke hente projekter");
      setData(await mapRes.json() as ProjectMapData);
      if (boardRes && boardRes.ok) {
        setBoard(await boardRes.json() as RepoBoardData);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Ukendt fejl");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const boardByRepo = useMemo(() => {
    const map = new Map<string, { laneTitle: string; resumePrompt: string }>();
    for (const lane of board?.lanes ?? []) {
      for (const repo of lane.repos) {
        map.set(repo.name.toLowerCase(), { laneTitle: lane.title, resumePrompt: repo.resumePrompt });
      }
    }
    return map;
  }, [board]);

  const enrichedProjects = useMemo(() => {
    if (!data) return [];
    const repoMeta = data.repoMeta ?? {};
    return data.projects.map((project) => {
      const repos = project.repos?.length ? project.repos : project.repo ? [project.repo] : [];
      const metas = repos.map((r) => repoMeta[r]).filter((m): m is RepoMeta => Boolean(m));
      const firstMeta = metas[0];
      const releaseMeta = metas.find((m) => Boolean(m.latestRelease));
      const prodUrl =
        safeUrl(project.productionUrl) ??
        project.domains.map(safeUrl).find((u): u is string => Boolean(u)) ??
        project.workers.flatMap((w) => data.workerPublicUrls[w] ?? []).map(safeUrl).find((u): u is string => Boolean(u)) ??
        safeUrl(firstMeta?.homepage) ??
        null;

      const boardMatch = repos.map((r) => boardByRepo.get(repoShortName(r).toLowerCase())).find(Boolean) ?? null;

      return {
        project,
        repos,
        firstMeta,
        latestRelease: releaseMeta?.latestRelease ?? null,
        prodUrl,
        boardMatch,
      };
    });
  }, [data, boardByRepo]);

  const visibleProjects = useMemo(() => {
    const q = search.trim().toLowerCase();
    return enrichedProjects
      .filter(({ project, prodUrl, latestRelease }) => {
        const isHidden = project.hidden === true;
        if (filter === "hidden") return isHidden;
        if (isHidden) return false;
        if (filter === "public" && !project.isPublic) return false;
        if (filter === "web" && !prodUrl) return false;
        if (filter === "desktop" && !latestRelease) return false;
        if (!q) return true;
        const desc = (project.description ?? "").toLowerCase();
        const cat = (project.category ?? "").toLowerCase();
        return project.title.toLowerCase().includes(q) || desc.includes(q) || cat.includes(q);
      })
      .sort((a, b) => {
        if ((a.project.pinned === true) !== (b.project.pinned === true)) return a.project.pinned ? -1 : 1;
        return a.project.title.localeCompare(b.project.title);
      });
  }, [enrichedProjects, filter, search]);

  async function togglePublic(project: Project) {
    if (!data) return;
    setTogglingId(project.id);
    setError("");
    const existing = data.registry.find((entry) => entry.id === project.id);
    const repos = existing?.repos ?? project.repos ?? (project.repo ? [project.repo] : []);
    try {
      const response = await fetch("/api/project-map/registry", {
        method: "PUT",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: project.id,
          title: existing?.title ?? project.title,
          repos,
          workers: existing?.workers ?? project.workers,
          pages: existing?.pages ?? project.pages,
          domains: existing?.domains ?? project.domains,
          confirmed: existing?.confirmed ?? project.confirmed ?? false,
          description: existing?.description ?? project.description ?? "",
          category: existing?.category ?? project.category ?? "",
          productionUrl: existing?.productionUrl ?? project.productionUrl ?? "",
          isPublic: !project.isPublic,
          showRepoPublic: existing?.showRepoPublic ?? project.showRepoPublic ?? true,
          hidden: existing?.hidden ?? project.hidden ?? false,
          pinned: existing?.pinned ?? project.pinned ?? false,
        }),
      });
      if (!response.ok) throw new Error("Kunne ikke opdatere offentlig status");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Kunne ikke opdatere");
    } finally {
      setTogglingId(null);
    }
  }

  function copyPrompt(id: string, prompt: string) {
    void navigator.clipboard.writeText(prompt).then(() => {
      setCopiedId(id);
      window.setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1500);
    });
  }

  function openPrefilled(fullName: string) {
    const meta = data?.repoMeta?.[fullName];
    setPrefill({
      id: repoShortName(fullName).toLowerCase().replace(/[^a-z0-9_-]+/g, "-"),
      title: titleFromRepo(fullName),
      repos: [fullName],
      description: meta?.description ?? "",
      productionUrl: safeUrl(meta?.homepage) ?? "",
    });
    setEditing("new");
  }

  if (error && !data) {
    return <p className="project-map-notice project-map-notice--warning">{error}</p>;
  }
  if (!data) {
    return <p className="ui-muted">Indlæser projektoversigt…</p>;
  }

  return (
    <div className="project-map-page">
      <div className="apps-catalog-toolbar">
        <input
          type="search"
          className="apps-search"
          placeholder="Søg i projekter…"
          aria-label="Søg i projekter"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className="project-toolbar-actions">
          <a className="ui-btn ui-btn--ghost" href="/apps" target="_blank" rel="noopener noreferrer">
            Åbn /apps ↗
          </a>
          <button
            type="button"
            className="ui-btn"
            onClick={() => { setPrefill(null); setEditing("new"); }}
          >
            + Nyt projekt
          </button>
          <button
            type="button"
            className="ui-btn ui-btn--primary"
            disabled={refreshing || !data.liveRefreshReady}
            onClick={() => void load("POST")}
          >
            {refreshing ? "Opdaterer…" : "Opdatér"}
          </button>
        </div>
      </div>

      {error && <p className="project-map-notice project-map-notice--warning">{error}</p>}

      <div className="project-map-filters" role="group" aria-label="Filtrer projekter">
        {(
          [
            ["all", "Alle"],
            ["public", "Offentlige"],
            ["web", "Web"],
            ["desktop", "Desktop / Releases"],
            ["hidden", "Skjulte"],
          ] as Array<[Filter, string]>
        ).map(([key, label]) => (
          <button key={key} type="button" className={filter === key ? "active" : ""} onClick={() => setFilter(key)}>
            {label}
          </button>
        ))}
      </div>

      {visibleProjects.length === 0 ? (
        <section className="ui-card">
          <p className="ui-muted">Ingen projekter matcher filteret.</p>
        </section>
      ) : (
        <div className="apps-catalog-grid">
          {visibleProjects.map(({ project, firstMeta, latestRelease, prodUrl, boardMatch }) => {
            const desc = project.description?.trim() || firstMeta?.description?.trim() || "";
            const preferredAsset = latestRelease?.assets.find((a) => /\.(exe|msi|dmg|appimage|deb|zip)$/i.test(a.name)) ?? latestRelease?.assets[0];

            return (
              <article className="ui-card apps-catalog-card" key={project.id}>
                <div className="apps-card-head">
                  <h3 className="ui-card-title">{project.title}</h3>
                  <div className="apps-card-pills">
                    {project.isPublic && <span className="ui-pill ui-pill--ok">Offentlig</span>}
                    {project.category && <span className="ui-pill">{project.category}</span>}
                    {boardMatch && <span className="ui-pill ui-pill--info">{boardMatch.laneTitle}</span>}
                  </div>
                </div>

                <p className={desc ? "apps-card-desc" : "apps-card-desc ui-muted"}>
                  {desc || "Ingen beskrivelse endnu."}
                </p>

                <div className="apps-actions">
                  {prodUrl && (
                    <a className="ui-btn ui-btn--primary" href={prodUrl} target="_blank" rel="noopener noreferrer">
                      Åbn ↗
                    </a>
                  )}
                  {latestRelease && (
                    <a
                      className={prodUrl ? "ui-btn" : "ui-btn ui-btn--primary"}
                      href={preferredAsset?.downloadUrl ?? latestRelease.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Download {latestRelease.tag}
                    </a>
                  )}
                  {firstMeta && (
                    <a className="ui-btn ui-btn--ghost" href={firstMeta.url} target="_blank" rel="noopener noreferrer">
                      GitHub ↗
                    </a>
                  )}
                </div>

                <div className="ui-card-footer">
                  <button
                    type="button"
                    className="ui-btn ui-btn--ghost"
                    disabled={togglingId === project.id}
                    onClick={() => void togglePublic(project)}
                  >
                    {togglingId === project.id ? "Gemmer…" : project.isPublic ? "Gør privat" : "Gør offentlig"}
                  </button>
                  <div className="rb-btns">
                    {boardMatch && (
                      <button
                        type="button"
                        className="ui-btn ui-btn--ghost"
                        onClick={() => copyPrompt(project.id, boardMatch.resumePrompt)}
                      >
                        {copiedId === project.id ? "Kopieret" : "Kopiér prompt"}
                      </button>
                    )}
                    <button
                      type="button"
                      className="ui-btn"
                      onClick={() => { setPrefill(null); setEditing(project.id); }}
                    >
                      Redigér
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {data.repoOnly.length > 0 && (
        <details className="ui-section" data-tone="quiet">
          <summary>
            Ikke-opsatte GitHub-repos <span className="ui-count">{data.repoOnly.length}</span>
          </summary>
          <div className="apps-unmapped-list">
            {data.repoOnly.map((fullName) => {
              const meta = data.repoMeta?.[fullName];
              return (
                <div className="ui-card apps-unmapped-row" key={fullName}>
                  <div className="apps-unmapped-info">
                    <strong>{fullName}</strong>
                    {meta?.latestRelease && <span className="ui-pill">{meta.latestRelease.tag}</span>}
                    {meta?.description && <p className="ui-muted">{meta.description}</p>}
                  </div>
                  <button type="button" className="ui-btn ui-btn--primary" onClick={() => openPrefilled(fullName)}>
                    Opsæt
                  </button>
                </div>
              );
            })}
          </div>
        </details>
      )}

      {editing !== null && (
        <ProjectMapEditor
          key={editing === "new" ? `new-${prefill?.id ?? ""}` : editing}
          project={editing === "new" ? null : data.projects.find((p) => p.id === editing) ?? null}
          inventory={data.inventory}
          registry={data.registry}
          repoMeta={data.repoMeta}
          prefill={editing === "new" ? prefill : null}
          onClose={() => { setEditing(null); setPrefill(null); }}
          onSaved={async () => { await load(); }}
        />
      )}
    </div>
  );
}
