import { useEffect, useMemo, useState } from "react";

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

  useEffect(() => {
    void fetch("/api/public/apps", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("load_failed");
        setData(await response.json() as PublicAppsResponse);
      })
      .catch(() => setError(true));
  }, []);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const app of data?.apps ?? []) {
      if (app.category) set.add(app.category);
    }
    return ["All", ...Array.from(set).sort((a, b) => a.localeCompare(b))];
  }, [data]);

  const visibleApps = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.apps ?? []).filter((app) => {
      if (category !== "All" && app.category !== category) return false;
      if (!q) return true;
      return (
        app.title.toLowerCase().includes(q) ||
        app.description.toLowerCase().includes(q) ||
        app.category.toLowerCase().includes(q)
      );
    });
  }, [data, search, category]);

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
          <input
            type="search"
            className="apps-search"
            placeholder="Search apps and tools…"
            aria-label="Search apps and tools"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {categories.length > 1 && (
            <div className="project-map-filters" role="group" aria-label="Filter by category">
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  className={category === cat ? "active" : ""}
                  onClick={() => setCategory(cat)}
                >
                  {cat}
                </button>
              ))}
            </div>
          )}
        </div>

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
          <div className="apps-catalog-grid">
            {visibleApps.map((app) => {
              const assets = app.latestRelease?.assets ?? [];
              const preferred = assets.filter((a) => isPreferredAsset(a.name));
              const primaryAsset = preferred[0] ?? assets[0] ?? null;

              return (
                <article className="ui-card apps-catalog-card" key={app.id}>
                  <div className="apps-card-head">
                    <h2 className="ui-card-title">{app.title}</h2>
                    <div className="apps-card-pills">
                      {app.pinned && <span className="ui-pill ui-pill--info">Featured</span>}
                      {app.category && <span className="ui-pill">{app.category}</span>}
                    </div>
                  </div>

                  <p className={app.description ? "apps-card-desc" : "apps-card-desc ui-muted"}>
                    {app.description || "No description provided."}
                  </p>

                  <div className="apps-actions">
                    {app.productionUrl && (
                      <a
                        className="ui-btn ui-btn--primary"
                        href={app.productionUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open ↗
                      </a>
                    )}

                    {app.latestRelease && primaryAsset && (
                      <a
                        className={app.productionUrl ? "ui-btn" : "ui-btn ui-btn--primary"}
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
                        className={app.productionUrl ? "ui-btn" : "ui-btn ui-btn--primary"}
                        href={app.latestRelease.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Release {app.latestRelease.tag} ↗
                      </a>
                    )}

                    {app.repoUrl && (
                      <a
                        className="ui-btn ui-btn--ghost"
                        href={app.repoUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        GitHub ↗
                      </a>
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
                            <a
                              className="ui-link"
                              href={asset.downloadUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
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
            })}
          </div>
        )}
      </main>

      <footer className="public-apps-footer">
        <span>Nexus</span>
        <a className="ui-link" href="/">Sign in</a>
      </footer>
    </div>
  );
}
