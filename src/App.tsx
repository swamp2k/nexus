import { useEffect, useMemo, useState } from "react";
import type { FormEvent, MouseEvent } from "react";
import HomePage from "./HomePage";
import GarminPage from "./GarminPage";
import MotionPage from "./MotionPage";
import WellbeingPage from "./WellbeingPage";
import WeatherPage from "./WeatherPage";
import ElectricityPage from "./ElectricityPage";
import CalendarPage from "./CalendarPage";
import MelCloudPage from "./MelCloudPage";
import DisplaysPage from "./DisplaysPage";
import SettingsPage from "./SettingsPage";
import DisplayGate from "./DisplayGate";

type User = { id: string; email: string; displayName: string | null; role: "admin" | "member" | "viewer" };
type SessionResponse = { authenticated: boolean; user: User | null };
type Page = "Hjem" | "Garmin" | "Motion" | "Velbefindende" | "Vejr" | "Strøm" | "Kalender" | "Varmepumpe" | "Displays" | "DBA" | "Unraid" | "PC Watch" | "Indstillinger";
type PrimaryPage = Exclude<Page, "Indstillinger">;

const primaryNav: PrimaryPage[] = ["Hjem", "Garmin", "Motion", "Velbefindende", "Vejr", "Strøm", "Kalender", "Varmepumpe", "Displays", "DBA", "Unraid", "PC Watch"];
const secondaryNav = ["Overblik", "Notifikationer", "Indstillinger"] as const;
const navIcons = ["⌂", "⌖", "↗", "♥", "☁", "ϟ", "▦", "♨", "▣", "◇", "▤", "▣"];
const mobileNav: Array<{ page: Page; icon: string; label: string }> = [
  { page: "Hjem", icon: "⌂", label: "Hjem" }, { page: "Garmin", icon: "⌖", label: "Garmin" }, { page: "Motion", icon: "↗", label: "Motion" },
  { page: "Velbefindende", icon: "♥", label: "Velbefindende" }, { page: "Vejr", icon: "☁", label: "Vejr" }, { page: "Strøm", icon: "ϟ", label: "Strøm" },
  { page: "Kalender", icon: "▦", label: "Kalender" }, { page: "Varmepumpe", icon: "♨", label: "Varmepumpe" }, { page: "Displays", icon: "▣", label: "Displays" }, { page: "Indstillinger", icon: "⚙", label: "Indstillinger" },
];

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

  const displayName = useMemo(() => {
    const user = session?.user;
    if (!user) return "Nexus";
    return user.displayName?.trim() || user.email.split("@")[0];
  }, [session]);

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
  const subheading = isHome ? "Dit personlige overblik over de data, du faktisk vil se."
    : page === "Garmin" ? "Din sundhedshistorik samlet, importeret og klar til analyse."
    : page === "Motion" ? "Aktiviteter, træningshistorik og på sigt dine egne rekorder og træningsdata."
    : page === "Velbefindende" ? "Daglige målinger og journalnoter om hvordan du faktisk har det."
    : page === "Indstillinger" ? "Dine personlige Nexus-indstillinger."
    : page === "Strøm" ? "Spotpriser og de bedste tidspunkter at bruge strøm på."
    : page === "Kalender" ? "Dine kommende aftaler samlet fra iCal-kalendere."
    : page === "Varmepumpe" ? "Luft/vand-varmepumpen samlet fra MELCloud."
    : page === "Displays" ? "Byg og par dashboards til iPads og andre faste skærme." : "";

  return <div className="app-frame">
    <aside className="sidebar">
      <div className="sidebar-brand"><div className="brand-mark">N</div><span className="brand-word">NEXUS</span></div>
      <nav className="sidebar-nav" aria-label="Primær navigation">{primaryNav.map((item, index) => <button className={`nav-item ${page === item ? "active" : ""}`} key={item} type="button" onClick={() => setPage(item)}><span className="nav-icon">{navIcons[index]}</span><span>{item}</span></button>)}</nav>
      <div className="sidebar-divider" />
      <nav className="sidebar-nav sidebar-nav--secondary" aria-label="Sekundær navigation">{secondaryNav.map((item, index) => {
        const active = item === "Indstillinger" && page === "Indstillinger";
        return <button className={`nav-item ${active ? "active" : ""}`} key={item} type="button" onClick={() => { if (item === "Overblik") setPage("Hjem"); if (item === "Indstillinger") setPage("Indstillinger"); }}><span className="nav-icon">{["▦", "♧", "⚙"][index]}</span><span>{item}</span></button>;
      })}</nav>
      <nav className="mobile-nav" aria-label="Mobil navigation">{mobileNav.map((item) => <button className={page === item.page ? "active" : ""} key={item.page} type="button" onClick={() => setPage(item.page)} aria-current={page === item.page ? "page" : undefined}><span>{item.icon}</span><strong>{item.label}</strong></button>)}</nav>
      <div className="system-status"><span className="status-dot" /><div><small>Systemstatus</small><strong>Alt kører</strong></div></div>
    </aside>

    <div className="content-shell">
      <header className="app-header"><div><h1>{heading}</h1>{subheading && <p>{subheading}</p>}</div><div className="header-actions"><button className="theme-toggle" onClick={toggleTheme} aria-label="Skift tema">{theme === "light" ? "☾" : "☀"}</button><details className="user-menu"><summary className="user-menu-summary" aria-label="Åbn brugermenu"><span className="avatar">{initials(session.user)}</span><span className="user-name">{displayName}</span></summary><div className="user-menu-popover"><button type="button" onClick={(event) => { setPage("Indstillinger"); closeUserMenu(event); }}>Indstillinger</button><button className="logout-button" type="button" onClick={logout}>Log ud</button></div></details></div></header>
      <main className="main-content">
        {page === "Hjem" && <HomePage onOpenPage={setPage} />}{page === "Garmin" && <GarminPage />}{page === "Motion" && <MotionPage />}{page === "Velbefindende" && <WellbeingPage />}{page === "Vejr" && <WeatherPage />}{page === "Strøm" && <ElectricityPage />}{page === "Kalender" && <CalendarPage />}{page === "Varmepumpe" && <MelCloudPage />}{page === "Displays" && <DisplaysPage />}{page === "Indstillinger" && <SettingsPage />}
        {!isHome && page !== "Garmin" && page !== "Motion" && page !== "Velbefindende" && page !== "Vejr" && page !== "Strøm" && page !== "Kalender" && page !== "Varmepumpe" && page !== "Displays" && page !== "Indstillinger" && <section className="placeholder-card"><p className="section-label">Planlagt</p><h2>{page}</h2><p>Modulet er på vej ind i Nexus.</p></section>}
      </main>
      <footer><span>Nexus v0.1</span><span>Simple by design.</span></footer>
    </div>
  </div>;
}

export default App;
