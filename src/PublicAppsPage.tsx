import { useEffect, useMemo, useState } from "react";
import {
  GithubIcon,
  GridIcon,
  ListIcon,
  ProjectIcon,
  categoryTone,
  displayHost,
  groupIntoShelves,
} from "./catalogVisuals";
import type { CategoryTone } from "./catalogVisuals";

type ReleaseAsset = {
  name: string;
  downloadUrl: string;
  size: number;
};

type PublicApp = {
  id: string;
  title: string;
  description: string;
  category: string;
  icon?: string;
  productionUrl: string | null;
  repoUrl: string | null;
  latestRelease: {
    tag: string;
    name: string;
    url: string;
    publishedAt: string | null;
    assets: ReleaseAsset[];
  } | null;
  pinned: boolean;
};

type PublicAppsResponse = {
  generatedAt: string | null;
  apps: PublicApp[];
};

type ViewMode = "grid" | "list";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isPreferredAsset(name: string): boolean {
  return /\.(exe|msi|dmg|appimage|deb|zip)$/i.test(name);
}

export default function PublicAppsPage({
  theme,
  onThemeChange,
}: {
  theme: "light" | "dark";
  onThemeChange: (next: "light" | "dark") => void;
}) {
  const [data, setData] = useState<PublicAppsResponse | null>(null);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem("nexus-public-apps-view");
    return saved === "list" ? "list" : "grid";
  });

  useEffect(() => {
    localStorage.setItem("nexus-public-apps-view", viewMode);
  }, [viewMode]);

  useEffect(() => {
    void fetch("/api/public/apps", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("load_failed");
        setData(await response.json() as PublicAppsResponse);
      })
      .catch(() => setError(true));
  }, []);

  const categories = useMemo(() => {
    const counts = new Map<string, { name: string; count: number; tone: CategoryTone }>();
    for (const app of data?.apps ?? []) {
      const raw = app.category.trim();
      if (!raw) continue;
      const key = raw.toLowerCase();
      const existing = counts.get(key);
      if (existing) existing.count += 1;
      else counts.set(key, { name: raw, count: 1, tone: categoryTone(raw) });
    }
    return Array.from(counts.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);

  const visibleApps = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.apps ?? []).filter((app) => {
      if (category !== "All" && app.category.trim().toLowerCase() !== category.toLowerCase()) return false;
      if (!q) return true;
      return (
        app.title.toLowerCase().includes(q) ||
        app.description.toLowerCase().includes(q) ||
        app.category.toLowerCase().includes(q)
      );
    });
  }, [data, search, category]);

  const useShelves = category === "All" && !search.trim();
  const shelves = useMemo(() => {
    if (!useShelves) return [];
    return groupIntoShelves(visibleApps, {
      getCategory: (app) => app.category,
      getPinned: (app) => app.pinned,
      featuredLabel: "Featured",
      uncategorizedLabel: "Other",
    });
  }, [useShelves, visibleApps]);

  function renderApp(app: PublicApp) {
    const assets = app.latestRelease?.assets ?? [];
    const preferred = assets.filter((a) => isPreferredAsset(a.name));
    const primaryAsset = preferred[0] ?? assets[0] ?? null;
    const tone = categoryTone(app.category);
    const host = displayHost(app.productionUrl);

    if (viewMode === "list") {
      return (
        <div className="apps-list-row" data-tone={tone} key={app.id}>
          <ProjectIcon icon={app.icon} title={app.title} category={app.category} size="sm" />
          <div className="apps-list-main">
            <div className="apps-list-title-row">
              <strong>{app.title}</strong>
              {app.pinned && <span className="ui-pill ui-pill--info">Featured</span>}
              {app.category && (
                <button type="button" className="apps-cat-pill" data-tone={tone} onClick={() => setCategory(app.category)}>
                  {app.category}
                </button>
              )}
            </div>
            <p className="apps-list-sub">{app.description || host || ""}</p>
          </div>
          <div className="apps-list-actions">
            {app.productionUrl && (
              <a className="apps-btn-compact apps-btn-compact--primary" href={app.productionUrl} target="_blank" rel="noopener noreferrer">
                Open ↗
              </a>
            )}
            {app.latestRelease && primaryAsset && (
              <a
                className={app.productionUrl ? "apps-btn-compact" : "apps-btn-compact apps-btn-compact--primary"}
                href={primaryAsset.downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                title={primaryAsset.name}
              >
                Download {app.latestRelease.tag}
              </a>
            )}
            {app.latestRelease && !primaryAsset && (
              <a
                className={app.productionUrl ? "apps-btn-compact" : "apps-btn-compact apps-btn-compact--primary"}
                href={app.latestRelease.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {app.latestRelease.tag} ↗
              </a>
            )}
            {app.repoUrl && (
              <a className="apps-icon-btn" href={app.repoUrl} target="_blank" rel="noopener noreferrer" title="GitHub" aria-label="GitHub">
                <GithubIcon />
              </a>
            )}
          </div>
        </div>
      );
    }

    return (
      <article className="apps-tile" data-tone={tone} key={app.id}>
        <div className="apps-tile-head">
          <ProjectIcon icon={app.icon} title={app.title} category={app.category} />
          <div className="apps-tile-title-wrap">
            <div className="apps-tile-title-row">
              <h3>{app.title}</h3>
            </div>
            <div className="apps-tile-badges">
              {app.pinned && <span className="ui-pill ui-pill--info">Featured</span>}
              {app.category && (
                <button type="button" className="apps-cat-pill" data-tone={tone} onClick={() => setCategory(app.category)}>
                  {app.category}
                </button>
              )}
            </div>
          </div>
        </div>

        {app.description ? (
          <p className="apps-tile-desc">{app.description}</p>
        ) : host ? (
          <p className="apps-tile-meta">{host}</p>
        ) : null}

        <div className="apps-tile-bar">
          <div className="apps-tile-primary">
            {app.productionUrl && (
              <a className="apps-btn-compact apps-btn-compact--primary" href={app.productionUrl} target="_blank" rel="noopener noreferrer">
                Open ↗
              </a>
            )}
            {app.latestRelease && primaryAsset && (
              <a
                className={app.productionUrl ? "apps-btn-compact" : "apps-btn-compact apps-btn-compact--primary"}
                href={primaryAsset.downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                title={primaryAsset.name}
              >
                Download {app.latestRelease.tag}
                {primaryAsset.size > 0 ? ` (${formatBytes(primaryAsset.size)})` : ""}
              </a>
            )}
            {app.latestRelease && !primaryAsset && (
              <a
                className={app.productionUrl ? "apps-btn-compact" : "apps-btn-compact apps-btn-compact--primary"}
                href={app.latestRelease.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Release {app.latestRelease.tag} ↗
              </a>
            )}
          </div>
          {app.repoUrl && (
            <div className="apps-icon-actions">
              <a className="apps-icon-btn" href={app.repoUrl} target="_blank" rel="noopener noreferrer" title="GitHub" aria-label="GitHub">
                <GithubIcon />
              </a>
            </div>
          )}
        </div>

        {app.latestRelease && assets.length > 1 && (
          <details className="apps-assets-details">
            <summary className="ui-muted">
              All downloads ({assets.length} files · {app.latestRelease.tag})
            </summary>
            <ul className="apps-assets-list">
              {assets.map((asset) => (
                <li key={asset.name}>
                  <a className="ui-link" href={asset.downloadUrl} target="_blank" rel="noopener noreferrer">
                    {asset.name}
                  </a>
                  {asset.size > 0 && <span className="ui-muted"> · {formatBytes(asset.size)}</span>}
                </li>
              ))}
            </ul>
          </details>
        )}
      </article>
    );
  }

  return (
    <div className="public-apps-shell">
      <header className="public-apps-header">
        <div className="public-apps-brand">
          <div className="brand-mark">N</div>
          <div>
            <p className="brand-word">NEXUS</p>
            <small className="ui-muted">Apps &amp; Tools</small>
          </div>
        </div>
        <div className="public-apps-header-actions">
          <button
            type="button"
            className="theme-toggle"
            onClick={() => onThemeChange(theme === "light" ? "dark" : "light")}
            aria-label="Toggle theme"
          >
            {theme === "light" ? "☾" : "☀"}
          </button>
          <a className="ui-btn ui-btn--ghost" href="/">Sign in</a>
        </div>
      </header>

      <main className="public-apps-main">
        <section className="public-apps-intro">
          <h1>Apps &amp; Utilities</h1>
          <p className="ui-muted">
            A collection of web apps and desktop utilities built and maintained here.
          </p>
        </section>

        <div className="apps-catalog-toolbar">
          <div className="apps-toolbar-left">
            <input
              type="search"
              className="apps-search"
              placeholder="Search apps and tools…"
              aria-label="Search apps and tools"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <div className="apps-view-toggle" role="group" aria-label="View mode">
              <button
                type="button"
                className={viewMode === "grid" ? "active" : ""}
                aria-label="Grid view"
                title="Grid view"
                onClick={() => setViewMode("grid")}
              >
                <GridIcon />
              </button>
              <button
                type="button"
                className={viewMode === "list" ? "active" : ""}
                aria-label="List view"
                title="List view"
                onClick={() => setViewMode("list")}
              >
                <ListIcon />
              </button>
            </div>
          </div>
        </div>

        {categories.length > 0 && (
          <div className="project-map-filters" role="group" aria-label="Filter by category">
            <button
              type="button"
              className={category === "All" ? "active" : ""}
              onClick={() => setCategory("All")}
            >
              All
            </button>
            {categories.map((cat) => (
              <button
                key={cat.name}
                type="button"
                data-tone={cat.tone}
                className={`apps-filter-cat${category.toLowerCase() === cat.name.toLowerCase() ? " active" : ""}`}
                onClick={() => setCategory((cur) => (cur.toLowerCase() === cat.name.toLowerCase() ? "All" : cat.name))}
              >
                <span className="apps-tone-dot" />
                <span>{cat.name}</span>
                <small>{cat.count}</small>
              </button>
            ))}
          </div>
        )}

        {error && (
          <p className="project-map-notice project-map-notice--warning">
            Could not load apps right now. Please try again later.
          </p>
        )}

        {!data && !error && <p className="ui-muted">Loading apps…</p>}

        {data && visibleApps.length === 0 && (
          <section className="ui-card">
            <p className="ui-muted">No public apps match your filter.</p>
          </section>
        )}

        {data && visibleApps.length > 0 && (
          useShelves ? (
            <div className="apps-shelves">
              {shelves.map((shelf) => (
                <section className="apps-shelf" key={shelf.key}>
                  <header className="apps-shelf-head" data-tone={shelf.tone}>
                    <span className="apps-tone-dot" />
                    <h2>{shelf.isFeatured ? `★ ${shelf.label}` : shelf.label}</h2>
                    <span className="apps-shelf-count">{shelf.items.length}</span>
                  </header>
                  <div className={viewMode === "list" ? "apps-list" : "apps-catalog-grid"}>
                    {shelf.items.map(renderApp)}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className={viewMode === "list" ? "apps-list" : "apps-catalog-grid"}>
              {visibleApps.map(renderApp)}
            </div>
          )
        )}
      </main>

      <footer className="public-apps-footer">
        <span>Nexus</span>
        <a className="ui-link" href="/">Sign in</a>
      </footer>
    </div>
  );
}
