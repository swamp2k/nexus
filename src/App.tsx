import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";

type User = {
  id: string;
  email: string;
  displayName: string | null;
  role: "admin" | "member" | "viewer";
};

type SessionResponse = {
  authenticated: boolean;
  user: User | null;
};

type Module = {
  name: string;
  detail: string;
  status: string;
  tone: "blue" | "sky" | "amber" | "green" | "violet" | "teal";
  icon: string;
};

type Page = "Hjem" | "Garmin" | "Vejr" | "Strøm" | "DBA" | "Unraid" | "PC Watch";

const modules: Module[] = [
  { name: "Garmin", status: "First data module", detail: "Import, historik og analyse", tone: "blue", icon: "⌖" },
  { name: "Vejr", status: "Planned", detail: "Varsler og historik", tone: "sky", icon: "☁" },
  { name: "Strøm", status: "Planned", detail: "Priser og bedste tidspunkter", tone: "amber", icon: "ϟ" },
  { name: "DBA", status: "Later integration", detail: "Fund og monitorering", tone: "green", icon: "◇" },
  { name: "Unraid", status: "Later integration", detail: "Serverstatus og advarsler", tone: "violet", icon: "▤" },
  { name: "PC Watch", status: "Later integration", detail: "Maskinstatus samlet ét sted", tone: "teal", icon: "▣" },
];

const primaryNav: Page[] = ["Hjem", "Garmin", "Vejr", "Strøm", "DBA", "Unraid", "PC Watch"];
const secondaryNav = ["Overblik", "Notifikationer", "Indstillinger"];
const navIcons = ["⌂", "⌖", "☁", "ϟ", "◇", "▤", "▣"];

function initials(user: User | null): string {
  if (!user) return "N";
  const source = user.displayName?.trim() || user.email;
  return source.slice(0, 1).toUpperCase();
}

function Dashboard({ onOpen }: { onOpen: (page: Page) => void }) {
  return (
    <>
      <section className="hero-card" aria-labelledby="today-heading">
        <div>
          <p className="section-label">I dag</p>
          <h2 id="today-heading">Nexus er klar til første modul</h2>
          <p>Grundskallen kører. Garmin bliver første rigtige datapipeline, mens de øvrige projekter forbliver selvstændige.</p>
        </div>
        <span className="status-pill">Phase 0</span>
      </section>

      <section className="modules-section" aria-labelledby="modules-heading">
        <p className="section-label">Moduler</p>
        <h2 id="modules-heading">Dine øer, samlet</h2>

        <div className="module-grid">
          {modules.map((module) => (
            <button className="module-card" key={module.name} type="button" onClick={() => onOpen(module.name as Page)}>
              <div className={`module-icon tone-${module.tone}`}>{module.icon}</div>
              <div className="module-copy">
                <h3>{module.name}</h3>
                <p>{module.detail}</p>
                <span className={`module-badge tone-${module.tone}`}>{module.status}</span>
              </div>
              <span className="module-arrow">›</span>
            </button>
          ))}
        </div>
      </section>
    </>
  );
}

function GarminPage() {
  return (
    <section className="garmin-page" aria-labelledby="garmin-heading">
      <div className="module-page-hero">
        <div className="module-page-icon tone-blue">⌖</div>
        <div>
          <p className="section-label">Første datamodul</p>
          <h2 id="garmin-heading">Garmin</h2>
          <p>Få dine Garmin-data ud af silo'en, behold rådata og gør historikken søgbar, sammenlignelig og klar til analyse.</p>
        </div>
      </div>

      <div className="garmin-summary-grid">
        <article className="summary-card">
          <span className="summary-kicker">Status</span>
          <strong>Klar til første import</strong>
          <p>Bruger og datamodel er klar. Næste trin er at gemme den originale Garmin-export.</p>
        </article>
        <article className="summary-card">
          <span className="summary-kicker">Rådata</span>
          <strong>Bevares uændret</strong>
          <p>Originale ZIP, FIT, TCX, GPX og JSON-filer beholdes, så vi altid kan genbehandle dem senere.</p>
        </article>
        <article className="summary-card">
          <span className="summary-kicker">Analyse</span>
          <strong>Normaliseres til D1</strong>
          <p>Skridt, puls, søvn, aktiviteter og øvrige målinger bliver først modelleret efter en rigtig export.</p>
        </article>
      </div>

      <article className="import-card">
        <div>
          <p className="section-label">Import</p>
          <h3>Start med din Garmin-export</h3>
          <p>Vi bruger den komplette export som sandhedsgrundlag. Det undgår at bygge schema og parser efter antagelser om, hvad Garmin leverer.</p>
        </div>
        <div className="import-steps">
          <div><span>1</span><p>Hent en komplet Garmin-dataexport.</p></div>
          <div><span>2</span><p>Upload arkivet til Nexus.</p></div>
          <div><span>3</span><p>Nexus inventerer filerne og viser præcis hvilke datatyper der blev fundet.</p></div>
          <div><span>4</span><p>Derefter bygger vi den første parser og historikvisning.</p></div>
        </div>
        <button className="primary-action" type="button" disabled>Importér Garmin-export</button>
        <small className="import-note">Upload aktiveres, så snart rådata-lageret er bundet til Nexus.</small>
      </article>
    </section>
  );
}

function App() {
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [email, setEmail] = useState("");
  const [loginState, setLoginState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [page, setPage] = useState<Page>("Hjem");
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const saved = localStorage.getItem("nexus-theme");
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("nexus-theme", theme);
  }, [theme]);

  useEffect(() => {
    void fetch("/api/auth/me", { credentials: "same-origin" })
      .then((response) => response.json() as Promise<SessionResponse>)
      .then(setSession)
      .catch(() => setSession({ authenticated: false, user: null }));
  }, []);

  const displayName = useMemo(() => {
    const user = session?.user;
    if (!user) return "Nexus";
    return user.displayName?.trim() || user.email.split("@")[0];
  }, [session]);

  async function requestLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginState("sending");
    try {
      const response = await fetch("/api/auth/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!response.ok) throw new Error("request_failed");
      setLoginState("sent");
    } catch {
      setLoginState("error");
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    setSession({ authenticated: false, user: null });
  }

  if (!session) return <div className="screen-state">Indlæser Nexus…</div>;

  if (!session.authenticated) {
    return (
      <div className="login-shell">
        <button className="theme-toggle login-theme-toggle" onClick={() => setTheme(theme === "light" ? "dark" : "light")} aria-label="Skift tema">{theme === "light" ? "☾" : "☀"}</button>
        <section className="login-card">
          <div className="brand-mark">N</div>
          <p className="brand-word">NEXUS</p>
          <h1>Velkommen tilbage.</h1>
          <p className="login-copy">Skriv din mailadresse, så sender Nexus dig et sikkert login-link.</p>
          <form onSubmit={requestLogin} className="login-form">
            <label htmlFor="email">Mailadresse</label>
            <input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="dig@example.com" autoComplete="email" required />
            <button type="submit" disabled={loginState === "sending"}>{loginState === "sending" ? "Sender…" : "Send login-link"}</button>
          </form>
          {loginState === "sent" && <p className="login-feedback success">Tjek din indbakke. Linket virker i 15 minutter.</p>}
          {loginState === "error" && <p className="login-feedback error">Det lykkedes ikke at sende linket. Prøv igen.</p>}
        </section>
      </div>
    );
  }

  const isHome = page === "Hjem";
  const heading = isHome ? "Overblik uden bøvl." : page;
  const subheading = isHome
    ? "Én rolig indgang til data, overvågning og de små værktøjer familien faktisk bruger."
    : page === "Garmin"
      ? "Din sundheds- og aktivitetshistorik samlet, importeret og klar til analyse."
      : "Modulet er planlagt, men endnu ikke bygget.";

  return (
    <div className="app-frame">
      <aside className="sidebar">
        <div className="sidebar-brand"><div className="brand-mark">N</div><span className="brand-word">NEXUS</span></div>
        <nav className="sidebar-nav" aria-label="Primær navigation">
          {primaryNav.map((item, index) => (
            <button className={`nav-item ${page === item ? "active" : ""}`} key={item} type="button" onClick={() => setPage(item)}>
              <span className="nav-icon">{navIcons[index]}</span><span>{item}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-divider" />
        <nav className="sidebar-nav sidebar-nav--secondary" aria-label="Sekundær navigation">
          {secondaryNav.map((item, index) => <button className="nav-item" key={item} type="button"><span className="nav-icon">{["▦", "♧", "⚙"][index]}</span><span>{item}</span></button>)}
        </nav>
        <div className="system-status"><span className="status-dot" /><div><small>Systemstatus</small><strong>Alt kører</strong></div><span className="status-arrow">›</span></div>
      </aside>

      <div className="content-shell">
        <header className="app-header">
          <div><h1>{heading}</h1><p>{subheading}</p></div>
          <div className="header-actions">
            <button className="theme-toggle" onClick={() => setTheme(theme === "light" ? "dark" : "light")} aria-label="Skift tema">{theme === "light" ? "☾" : "☀"}</button>
            <div className="user-menu"><span className="avatar">{initials(session.user)}</span><span className="user-name">{displayName}</span><button className="logout-button" type="button" onClick={logout}>Log ud</button></div>
          </div>
        </header>

        <main className="main-content">
          {page === "Hjem" && <Dashboard onOpen={setPage} />}
          {page === "Garmin" && <GarminPage />}
          {!isHome && page !== "Garmin" && <section className="placeholder-card"><p className="section-label">Planlagt</p><h2>{page}</h2><p>Vi kommer hertil efter Garmin-pipelinen er på plads.</p></section>}
        </main>

        <footer><span>Nexus v0.1</span><span>Simple by design.</span></footer>
      </div>
    </div>
  );
}

export default App;
