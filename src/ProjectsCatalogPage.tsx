import { useCallback, useEffect, useMemo, useState } from "react";
import ProjectMapEditor from "./ProjectMapEditor";
import type { EditableProject, EditorPrefill, RegistryEntry, RepoMeta, ResourceInventory } from "./ProjectMapEditor";
import {
  CheckIcon,
  CopyIcon,
  EditIcon,
  GithubIcon,
  GlobeIcon,
  GridIcon,
  ListIcon,
  categoryTone,
  displayHost,
  groupIntoShelves,
  projectMonogram,
} from "./catalogVisuals";
import type { CategoryTone } from "./catalogVisuals";

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
type ViewMode = "grid" | "list";

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
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem("nexus-projects-view");
    return saved === "list" ? "list" : "grid";
  });
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [prefill, setPrefill] = useState<EditorPrefill | null>(null);

  useEffect(() => {
    localStorage.setItem("nexus-projects-view", viewMode);
  }, [viewMode]);

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

  const categories = useMemo(() => {
    const counts = new Map<string, { name: string; count: number; tone: CategoryTone }>();
    for (const { project } of enrichedProjects) {
      if (project.hidden) continue;
      const raw = (project.category ?? "").trim();
      if (!raw) continue;
      const key = raw.toLowerCase();
      const existing = counts.get(key);
      if (existing) existing.count += 1;
      else counts.set(key, { name: raw, count: 1, tone: categoryTone(raw) });
    }
    return Array.from(counts.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [enrichedProjects]);

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
        if (selectedCategory && (project.category ?? "").trim().toLowerCase() !== selectedCategory.toLowerCase()) {
          return false;
        }
        if (!q) return true;
        const desc = (project.description ?? "").toLowerCase();
        const cat = (project.category ?? "").toLowerCase();
        return project.title.toLowerCase().includes(q) || desc.includes(q) || cat.includes(q);
      })
      .sort((a, b) => {
        if ((a.project.pinned === true) !== (b.project.pinned === true)) return a.project.pinned ? -1 : 1;
        return a.project.title.localeCompare(b.project.title);
      });
  }, [enrichedProjects, filter, selectedCategory, search]);

  const useShelves = selectedCategory === null && filter !== "hidden" && !search.trim();
  const shelves = useMemo(() => {
    if (!useShelves) return [];
    return groupIntoShelves(visibleProjects, {
      getCategory: (item) => item.project.category ?? "",
      getPinned: (item) => item.project.pinned === true,
      featuredLabel: "Fastgjorte",
      uncategorizedLabel: "Uden kategori",
    });
  }, [useShelves, visibleProjects]);

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
          icon: existing?.icon ?? project.icon ?? "",
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

  function selectCategoryPill(name: string) {
    if (filter === "hidden") setFilter("all");
    setSelectedCategory((cur) => (cur?.toLowerCase() === name.toLowerCase() ? null : name));
  }

  function renderItem(item: (typeof visibleProjects)[number]) {
    const { project, firstMeta, latestRelease, prodUrl, boardMatch } = item;
    const desc = project.description?.trim() || firstMeta?.description?.trim() || "";
    const host = displayHost(prodUrl);
    const tone = categoryTone(project.category ?? "");
    const glyph = project.icon?.trim() || projectMonogram(project.title);
    const preferredAsset = latestRelease?.assets.find((a) => /\.(exe|msi|dmg|appimage|deb|zip)$/i.test(a.name)) ?? latestRelease?.assets[0];

    const iconActions = (
      <div className="apps-icon-actions">
        <button
          type="button"
          className={`apps-icon-btn${project.isPublic ? " is-active" : ""}`}
          disabled={togglingId === project.id}
          title={project.isPublic ? "Offentlig på /apps — klik for at gøre privat" : "Privat — klik for at gøre offentlig"}
          aria-label={project.isPublic ? "Gør privat" : "Gør offentlig"}
          onClick={() => void togglePublic(project)}
        >
          <GlobeIcon />
        </button>
        {boardMatch && (
          <button
            type="button"
            className={`apps-icon-btn${copiedId === project.id ? " is-copied" : ""}`}
            title={copiedId === project.id ? "Kopieret!" : `Kopiér resume-prompt (${boardMatch.laneTitle})`}
            aria-label="Kopiér prompt"
            onClick={() => copyPrompt(project.id, boardMatch.resumePrompt)}
          >
            {copiedId === project.id ? <CheckIcon /> : <CopyIcon />}
          </button>
        )}
        {firstMeta && (
          <a
            className="apps-icon-btn"
            href={firstMeta.url}
            target="_blank"
            rel="noopener noreferrer"
            title="Åbn GitHub-repo"
            aria-label="Åbn GitHub-repo"
          >
            <GithubIcon />
          </a>
        )}
        <button
          type="button"
          className="apps-icon-btn"
          title="Redigér projekt"
          aria-label="Redigér projekt"
          onClick={() => { setPrefill(null); setEditing(project.id); }}
        >
          <EditIcon />
        </button>
      </div>
    );

    if (viewMode === "list") {
      return (
        <div className="apps-list-row" data-tone={tone} key={project.id}>
          <span className="apps-tile-icon apps-tile-icon--sm" data-tone={tone} aria-hidden="true">{glyph}</span>
          <div className="apps-list-main">
            <div className="apps-list-title-row">
              <strong>{project.title}</strong>
              {project.isPublic && <span className="apps-dot-public" title="Offentlig på /apps" />}
              {project.category && (
                <button
                  type="button"
                  className="apps-cat-pill"
                  data-tone={tone}
                  onClick={() => selectCategoryPill(project.category!)}
                >
                  {project.category}
                </button>
              )}
              {boardMatch && <span className="ui-pill ui-pill--info">{boardMatch.laneTitle}</span>}
            </div>
            <p className="apps-list-sub">
              {desc || host || (firstMeta ? repoShortName(firstMeta.fullName) : "")}
            </p>
          </div>
          <div className="apps-list-actions">
            {prodUrl && (
              <a className="apps-btn-compact apps-btn-compact--primary" href={prodUrl} target="_blank" rel="noopener noreferrer">
                Åbn ↗
              </a>
            )}
            {latestRelease && (
              <a
                className={prodUrl ? "apps-btn-compact" : "apps-btn-compact apps-btn-compact--primary"}
                href={preferredAsset?.downloadUrl ?? latestRelease.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {latestRelease.tag}
              </a>
            )}
            {iconActions}
          </div>
        </div>
      );
    }

    return (
      <article className="apps-tile" data-tone={tone} key={project.id}>
        <div className="apps-tile-head">
          <span className="apps-tile-icon" data-tone={tone} aria-hidden="true">{glyph}</span>
          <div className="apps-tile-title-wrap">
            <div className="apps-tile-title-row">
              <h3>{project.title}</h3>
              {project.isPublic && <span className="apps-dot-public" title="Offentlig på /apps" />}
            </div>
            <div className="apps-tile-badges">
              {project.category && (
                <button
                  type="button"
                  className="apps-cat-pill"
                  data-tone={tone}
                  onClick={() => selectCategoryPill(project.category!)}
                >
                  {project.category}
                </button>
              )}
              {boardMatch && <span className="apps-lane-tag">{boardMatch.laneTitle}</span>}
            </div>
          </div>
        </div>

        {desc ? (
          <p className="apps-tile-desc">{desc}</p>
        ) : host ? (
          <p className="apps-tile-meta">{host}</p>
        ) : firstMeta ? (
          <p className="apps-tile-meta">{repoShortName(firstMeta.fullName)}</p>
        ) : null}

        <div className="apps-tile-bar">
          <div className="apps-tile-primary">
            {prodUrl && (
              <a className="apps-btn-compact apps-btn-compact--primary" href={prodUrl} target="_blank" rel="noopener noreferrer">
                Åbn ↗
              </a>
            )}
            {latestRelease && (
              <a
                className={prodUrl ? "apps-btn-compact" : "apps-btn-compact apps-btn-compact--primary"}
                href={preferredAsset?.downloadUrl ?? latestRelease.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Download {latestRelease.tag}
              </a>
            )}
          </div>
          {iconActions}
        </div>
      </article>
    );
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
        <div className="apps-toolbar-left">
          <input
            type="search"
            className="apps-search"
            placeholder="Søg i projekter…"
            aria-label="Søg i projekter"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className="apps-view-toggle" role="group" aria-label="Visning">
            <button
              type="button"
              className={viewMode === "grid" ? "active" : ""}
              aria-label="Kortvisning"
              title="Kortvisning"
              onClick={() => setViewMode("grid")}
            >
              <GridIcon />
            </button>
            <button
              type="button"
              className={viewMode === "list" ? "active" : ""}
              aria-label="Listevisning"
              title="Listevisning"
              onClick={() => setViewMode("list")}
            >
              <ListIcon />
            </button>
          </div>
        </div>
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
            ["desktop", "Desktop"],
            ["hidden", "Skjulte"],
          ] as Array<[Filter, string]>
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={filter === key && !selectedCategory ? "active" : ""}
            onClick={() => { setFilter(key); if (key === "hidden") setSelectedCategory(null); }}
          >
            {label}
          </button>
        ))}

        {categories.length > 0 && <span className="apps-filter-sep" aria-hidden="true" />}

        {categories.map((cat) => (
          <button
            key={cat.name}
            type="button"
            data-tone={cat.tone}
            className={`apps-filter-cat${selectedCategory?.toLowerCase() === cat.name.toLowerCase() ? " active" : ""}`}
            onClick={() => selectCategoryPill(cat.name)}
          >
            <span className="apps-tone-dot" />
            <span>{cat.name}</span>
            <small>{cat.count}</small>
          </button>
        ))}
      </div>

      {visibleProjects.length === 0 ? (
        <section className="ui-card">
          <p className="ui-muted">Ingen projekter matcher filteret.</p>
        </section>
      ) : useShelves ? (
        <div className="apps-shelves">
          {shelves.map((shelf) => (
            <section className="apps-shelf" key={shelf.key}>
              <header className="apps-shelf-head" data-tone={shelf.tone}>
                <span className="apps-tone-dot" />
                <h2>{shelf.isFeatured ? `★ ${shelf.label}` : shelf.label}</h2>
                <span className="apps-shelf-count">{shelf.items.length}</span>
              </header>
              <div className={viewMode === "list" ? "apps-list" : "apps-catalog-grid"}>
                {shelf.items.map(renderItem)}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className={viewMode === "list" ? "apps-list" : "apps-catalog-grid"}>
          {visibleProjects.map(renderItem)}
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
          existingCategories={categories.map((c) => c.name)}
          onClose={() => { setEditing(null); setPrefill(null); }}
          onSaved={async () => { await load(); }}
        />
      )}
    </div>
  );
}
