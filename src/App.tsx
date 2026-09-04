import { useEffect, useMemo, useState } from "react";
import type { DragEvent, FormEvent, MouseEvent } from "react";
import HomePage from "./HomePage";
import GarminPage from "./GarminPage";
import MotionPage from "./MotionPage";
import WellbeingPage from "./WellbeingPage";
import WeatherPage from "./WeatherPage";
import ElectricityPage from "./ElectricityPage";
import CalendarPage from "./CalendarPage";
import MelCloudPage from "./MelCloudPage";
import UnraidPage from "./UnraidPage";
import DisplaysPage from "./DisplaysPage";
import SettingsPage from "./SettingsPage";
import DisplayGate from "./DisplayGate";

type User = { id: string; email: string; displayName: string | null; role: "admin" | "member" | "viewer" };
type SessionResponse = { authenticated: boolean; user: User | null };
type NavPage = "Hjem" | "Garmin" | "Motion" | "Velbefindende" | "Vejr" | "Strøm" | "Kalender" | "Varmepumpe" | "DBA" | "Unraid" | "PC Watch" | "Notifikationer" | "Displays";
type Page = NavPage | "Indstillinger";

type NavDefinition = { page: NavPage; icon: string; label: string };
const NAV_DEFINITIONS: NavDefinition[] = [
  { page: "Hjem", icon: "⌂", label: "Hjem" }, { page: "Garmin", icon: "⌖", label: "Garmin" }, { page: "Motion", icon: "↗", label: "Motion" },
  { page: "Velbefindende", icon: "♥", label: "Velbefindende" }, { page: "Vejr", icon: "☁", label: "Vejr" }, { page: "Strøm", icon: "ϟ", label: "Strøm" },
  { page: "Kalender", icon: "▦", label: "Kalender" }, { page: "Varmepumpe", icon: "♨", label: "Varmepumpe" }, { page: "DBA", icon: "◇", label: "DBA" },
  { page: "Unraid", icon: "▤", label: "Unraid" }, { page: "PC Watch", icon: "▣", label: "PC Watch" }, { page: "Notifikationer", icon: "♧", label: "Notifikationer" },
  { page: "Displays", icon: "▣", label: "Displays" },
];
const DEFAULT_NAV_ORDER = NAV_DEFINITIONS.map((item) => item.page);
const NAV_BY_PAGE = new Map(NAV_DEFINITIONS.map((item) => [item.page, item]));
const MOBILE_ALLOWED = new Set<NavPage>(["Hjem", "Garmin", "Motion", "Velbefindende", "Vejr", "Strøm", "Kalender", "Varmepumpe", "Unraid", "Displays"]);

function normalizeNavOrder(order: unknown): NavPage[] {
  const source = Array.isArray(order) ? order : [];
  const next: NavPage[] = [];
  for (const item of source) if (typeof item === "string" && NAV_BY_PAGE.has(item as NavPage) && !next.includes(item as NavPage)) next.push(item as NavPage);
  for (const item of DEFAULT_NAV_ORDER) if (!next.includes(item)) next.push(item);
  return next;
}

function initials(user: User | null): string {
  if (!user) return "N";
  const source = user.displayName?.trim() || user.email;
  return source.slice(0, 1).toUpperCase();
}

function App() {
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [email, setEmail] = useState("");
  const [loginState, setLoginState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [page, setPage] = useState<Page>("Hjem");
  const [navOrder, setNavOrder] = useState<NavPage[]>(DEFAULT_NAV_ORDER);
  const [editingNav, setEditingNav] = useState(false);
  const [draggedNav, setDraggedNav] = useState<NavPage | null>(null);
  const [navSaveState, setNavSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const saved = localStorage.getItem("nexus-theme");
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  const isDisplay = window.location.pathname === "/display" || window.location.pathname === "/display/kitchen";

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("nexus-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (isDisplay) { setSession({ authenticated: false, user: null }); return; }
    void fetch("/api/auth/me", { credentials: "same-origin" })
      .then((response) => response.json() as Promise<SessionResponse>)
      .then(setSession)
      .catch(() => setSession({ authenticated: false, user: null }));
  }, []);

  useEffect(() => {
    if (!session?.authenticated) return;
    void fetch("/api/navigation", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => response.ok ? response.json() as Promise<{ order: NavPage[] }> : Promise.reject())
      .then((body) => setNavOrder(normalizeNavOrder(body.order)))
      .catch(() => setNavOrder(DEFAULT_NAV_ORDER));
  }, [session?.authenticated]);

  const displayName = useMemo(() => {
    const user = session?.user;
    if (!user) return "Nexus";
    return user.displayName?.trim() || user.email.split("@")[0];
  }, [session]);
  const mobileNav = navOrder.filter((item) => MOBILE_ALLOWED.has(item));

  async function requestLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoginState("sending");
    try {
      const response = await fetch("/api/auth/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      if (!response.ok) throw new Error("request_failed");
      setLoginState("sent");
    } catch { setLoginState("error"); }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    setSession({ authenticated: false, user: null });
  }

  async function saveNavOrder(order: NavPage[]) {
    setNavSaveState("saving");
    try {
      const response = await fetch("/api/navigation", { method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order }) });
      if (!response.ok) throw new Error("save_failed");
      const body = await response.json() as { order: NavPage[] };
      setNavOrder(normalizeNavOrder(body.order));
      setNavSaveState("saved");
      window.setTimeout(() => setNavSaveState("idle"), 1200);
    } catch { setNavSaveState("error"); }
  }

  function moveNav(source: NavPage, target: NavPage) {
    if (source === target) return;
    const next = [...navOrder];
    const from = next.indexOf(source), to = next.indexOf(target);
    if (from < 0 || to < 0) return;
    next.splice(from, 1);
    next.splice(to, 0, source);
    setNavOrder(next);
    void saveNavOrder(next);
  }

  function navDrop(event: DragEvent<HTMLButtonElement>, target: NavPage) {
    event.preventDefault();
    if (draggedNav) moveNav(draggedNav, target);
    setDraggedNav(null);
  }

  function closeUserMenu(event: MouseEvent<HTMLButtonElement>) { event.currentTarget.closest("details")?.removeAttribute("open"); }
  function toggleTheme() { setTheme((current) => current === "light" ? "dark" : "light"); }

  if (isDisplay) return <DisplayGate theme={theme} onThemeChange={setTheme} />;
  if (!session) return <div className="screen-state">Indlæser Nexus…</div>;

  if (!session.authenticated) {
    return <div className="login-shell">
      <button className="theme-toggle login-theme-toggle" onClick={toggleTheme} aria-label="Skift tema">{theme === "light" ? "☾" : "☀"}</button>
      <section className="login-card"><div className="brand-mark">N</div><p className="brand-word">NEXUS</p><h1>Velkommen tilbage.</h1><p className="login-copy">Skriv din mailadresse, så sender Nexus dig et sikkert login-link.</p>
        <form onSubmit={requestLogin} className="login-form"><label htmlFor="email">Mailadresse</label><input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="dig@example.com" autoComplete="email" required /><button type="submit" disabled={loginState === "sending"}>{loginState === "sending" ? "Sender…" : "Send login-link"}</button></form>
        {loginState === "sent" && <p className="login-feedback success">Tjek din indbakke. Linket virker i 15 minutter.</p>}{loginState === "error" && <p className="login-feedback error">Det lykkedes ikke at sende linket. Prøv igen.</p>}
      </section>
    </div>;
  }

  const isHome = page === "Hjem";
  const heading = isHome ? "Hjem" : page;

  return <div className="app-frame">
    <aside className={`sidebar${editingNav ? " sidebar--editing" : ""}`}>
      <div className="sidebar-brand"><div className="brand-mark">N</div><span className="brand-word">NEXUS</span></div>
      <nav className="sidebar-nav" aria-label="Primær navigation">{navOrder.map((item) => {
        const definition = NAV_BY_PAGE.get(item)!;
        return <button className={`nav-item ${page === item ? "active" : ""}`} key={item} type="button" draggable={editingNav}
          onDragStart={() => setDraggedNav(item)} onDragOver={(event) => editingNav && event.preventDefault()} onDrop={(event) => editingNav && navDrop(event, item)}
          onClick={() => { if (!editingNav) setPage(item); }}>
          {editingNav && <span className="nav-drag-handle" aria-hidden="true">⋮⋮</span>}<span className="nav-icon">{definition.icon}</span><span>{definition.label}</span>
        </button>;
      })}</nav>
      <div className="sidebar-nav-edit-row"><button type="button" className="sidebar-nav-edit" onClick={() => setEditingNav((current) => !current)}>{editingNav ? "Færdig" : "Tilpas menu"}</button>{editingNav && navSaveState !== "idle" && <small>{navSaveState === "saving" ? "Gemmer…" : navSaveState === "saved" ? "Gemt" : "Kunne ikke gemme"}</small>}</div>
      <div className="sidebar-divider" />
      <nav className="sidebar-nav sidebar-nav--secondary" aria-label="Sekundær navigation"><button className={`nav-item ${page === "Indstillinger" ? "active" : ""}`} type="button" onClick={() => setPage("Indstillinger")}><span className="nav-icon">⚙</span><span>Indstillinger</span></button></nav>
      <nav className="mobile-nav" aria-label="Mobil navigation">{mobileNav.map((item) => { const definition = NAV_BY_PAGE.get(item)!; return <button className={page === item ? "active" : ""} key={item} type="button" onClick={() => setPage(item)} aria-current={page === item ? "page" : undefined}><span>{definition.icon}</span><strong>{definition.label}</strong></button>; })}<button className={page === "Indstillinger" ? "active" : ""} type="button" onClick={() => setPage("Indstillinger")}><span>⚙</span><strong>Indstillinger</strong></button></nav>
      <div className="system-status"><span className="status-dot" /><div><small>Systemstatus</small><strong>Alt kører</strong></div></div>
    </aside>

    <div className="content-shell">
      <header className="app-header"><div><h1>{heading}</h1></div><div className="header-actions"><button className="theme-toggle" onClick={toggleTheme} aria-label="Skift tema">{theme === "light" ? "☾" : "☀"}</button><details className="user-menu"><summary className="user-menu-summary" aria-label="Åbn brugermenu"><span className="avatar">{initials(session.user)}</span><span className="user-name">{displayName}</span></summary><div className="user-menu-popover"><button type="button" onClick={(event) => { setPage("Indstillinger"); closeUserMenu(event); }}>Indstillinger</button><button className="logout-button" type="button" onClick={logout}>Log ud</button></div></details></div></header>
      <main className="main-content">
        {page === "Hjem" && <HomePage onOpenPage={setPage} />}{page === "Garmin" && <GarminPage />}{page === "Motion" && <MotionPage />}{page === "Velbefindende" && <WellbeingPage />}{page === "Vejr" && <WeatherPage />}{page === "Strøm" && <ElectricityPage />}{page === "Kalender" && <CalendarPage />}{page === "Varmepumpe" && <MelCloudPage />}{page === "Unraid" && <UnraidPage />}{page === "Displays" && <DisplaysPage />}{page === "Indstillinger" && <SettingsPage />}
        {!isHome && page !== "Garmin" && page !== "Motion" && page !== "Velbefindende" && page !== "Vejr" && page !== "Strøm" && page !== "Kalender" && page !== "Varmepumpe" && page !== "Unraid" && page !== "Displays" && page !== "Indstillinger" && <section className="placeholder-card"><p className="section-label">Planlagt</p><h2>{page}</h2><p>Modulet er på vej ind i Nexus.</p></section>}
      </main>
      <footer><span>Nexus v0.1</span><span>Simple by design.</span></footer>
    </div>
  </div>;
}

export default App;
