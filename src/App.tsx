const modules = [
  { name: "Garmin", status: "First data module", detail: "Import, historik og analyse" },
  { name: "Vejr", status: "Planned", detail: "Varsler og historik" },
  { name: "Strøm", status: "Planned", detail: "Priser og bedste tidspunkter" },
  { name: "DBA", status: "Later integration", detail: "Fund og monitorering" },
  { name: "Unraid", status: "Later integration", detail: "Serverstatus og advarsler" },
  { name: "PC Watch", status: "Later integration", detail: "Maskinstatus samlet ét sted" },
];

function App() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">NEXUS</p>
          <h1>Overblik uden bøvl.</h1>
          <p className="lede">
            Én rolig indgang til data, overvågning og de små værktøjer familien faktisk bruger.
          </p>
        </div>
        <div className="avatar" aria-label="Brugerprofil">
          N
        </div>
      </header>

      <main>
        <section className="hero-card" aria-labelledby="today-heading">
          <div>
            <p className="section-label">I dag</p>
            <h2 id="today-heading">Nexus er klar til første modul</h2>
            <p>
              Grundskallen kører. Garmin bliver første rigtige datapipeline, mens de øvrige projekter forbliver selvstændige.
            </p>
          </div>
          <span className="status-pill">Phase 0</span>
        </section>

        <section className="section" aria-labelledby="modules-heading">
          <div className="section-heading">
            <div>
              <p className="section-label">Moduler</p>
              <h2 id="modules-heading">Dine øer, samlet</h2>
            </div>
          </div>

          <div className="module-grid">
            {modules.map((module) => (
              <article className="module-card" key={module.name}>
                <div className="module-card__topline">
                  <h3>{module.name}</h3>
                  <span>{module.status}</span>
                </div>
                <p>{module.detail}</p>
              </article>
            ))}
          </div>
        </section>
      </main>

      <footer>
        <span>Nexus v0.1</span>
        <span>Simple by design.</span>
      </footer>
    </div>
  );
}

export default App;
