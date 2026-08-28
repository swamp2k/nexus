import { useEffect, useMemo, useState } from "react";

type CachedEnvelope<T> = {
  data: T;
  fetchedAt: string;
  expiresAt: string;
  stale: boolean;
  lastErrorAt?: string | null;
  lastErrorMessage?: string | null;
};

type EnergyPricePoint = {
  timeUtc: string;
  eurPerMwh: number;
  approxDkkPerKwh: number;
};

type EnergyPriceData = {
  source: "Energi Data Service";
  area: string;
  resolutionMinutes: 15;
  currencyNote: string;
  intervals: EnergyPricePoint[];
};

type UsageDay = {
  date: string;
  kwh: number;
};

type UsageData = {
  source: "Eloverblik";
  days: UsageDay[];
};

type SourceStatus = {
  sources: {
    energyPrices: { configured: boolean; area: string };
    electricityUsage: { configured: boolean };
    wasteCalendar: { configured: boolean; implementation: string };
  };
};

type KitchenData = {
  prices: CachedEnvelope<EnergyPriceData> | null;
  usage: CachedEnvelope<UsageData> | null;
  status: SourceStatus | null;
};

const REFRESH_MS = 60_000;

function localHourLabel(iso: string): string {
  return new Intl.DateTimeFormat("da-DK", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

function shortDate(date: string): string {
  return new Intl.DateTimeFormat("da-DK", { weekday: "short", day: "numeric", month: "numeric" }).format(new Date(`${date}T12:00:00`));
}

function ageLabel(iso?: string | null): string {
  if (!iso) return "ukendt";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds} sek siden`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min siden`;
  const hours = Math.round(minutes / 60);
  return `${hours} t siden`;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store" });
  if (response.status === 503 || response.status === 501) return null;
  if (!response.ok) throw new Error(`${url}:${response.status}`);
  return response.json() as Promise<T>;
}

function PriceChart({ envelope }: { envelope: CachedEnvelope<EnergyPriceData> | null }) {
  const points = useMemo(() => {
    if (!envelope) return [];
    const now = Date.now();
    return envelope.data.intervals.filter((point) => {
      const t = new Date(point.timeUtc).getTime();
      return t >= now - 60 * 60 * 1000 && t <= now + 24 * 60 * 60 * 1000;
    });
  }, [envelope]);

  if (!envelope || points.length === 0) {
    return <div className="display-empty">Ingen strømpriser endnu</div>;
  }

  const values = points.map((point) => point.approxDkkPerKwh);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(0.01, max - min);
  const current = points.find((point, index) => {
    const start = new Date(point.timeUtc).getTime();
    const next = points[index + 1] ? new Date(points[index + 1].timeUtc).getTime() : start + 15 * 60 * 1000;
    return Date.now() >= start && Date.now() < next;
  }) ?? points[0];

  const width = 760;
  const height = 220;
  const paddingX = 16;
  const paddingY = 22;
  const path = points.map((point, index) => {
    const x = paddingX + (index / Math.max(1, points.length - 1)) * (width - paddingX * 2);
    const y = height - paddingY - ((point.approxDkkPerKwh - min) / span) * (height - paddingY * 2);
    return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  return (
    <div className="display-chart-block">
      <div className="display-metric-row">
        <div><span className="display-metric-label">Lige nu</span><strong>{current.approxDkkPerKwh.toFixed(2)} kr/kWh</strong></div>
        <div><span className="display-metric-label">Billigst næste 24 t</span><strong>{min.toFixed(2)} kr/kWh</strong></div>
      </div>
      <svg className="display-line-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Strømpris næste 24 timer">
        <line x1="16" y1="198" x2="744" y2="198" className="display-gridline" />
        <line x1="16" y1="110" x2="744" y2="110" className="display-gridline" />
        <path d={path} className="display-line" />
      </svg>
      <div className="display-chart-axis"><span>{localHourLabel(points[0].timeUtc)}</span><span>{localHourLabel(points[Math.floor(points.length / 2)].timeUtc)}</span><span>{localHourLabel(points[points.length - 1].timeUtc)}</span></div>
    </div>
  );
}

function UsageChart({ envelope }: { envelope: CachedEnvelope<UsageData> | null }) {
  const days = envelope?.data.days.slice(-7) ?? [];
  if (!envelope || days.length === 0) return <div className="display-empty">Elforbrug er ikke konfigureret endnu</div>;

  const max = Math.max(...days.map((day) => day.kwh), 1);
  return (
    <div className="usage-bars" aria-label="Elforbrug sidste 7 dage">
      {days.map((day) => (
        <div className="usage-bar-item" key={day.date}>
          <strong>{day.kwh.toFixed(1)}</strong>
          <div className="usage-bar-track"><span style={{ height: `${Math.max(5, (day.kwh / max) * 100)}%` }} /></div>
          <small>{shortDate(day.date)}</small>
        </div>
      ))}
    </div>
  );
}

function KitchenDisplay() {
  const [data, setData] = useState<KitchenData>({ prices: null, usage: null, status: null });
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const [prices, usage, status] = await Promise.all([
          fetchJson<CachedEnvelope<EnergyPriceData>>("/api/sources/energy/prices"),
          fetchJson<CachedEnvelope<UsageData>>("/api/sources/energy/usage"),
          fetchJson<SourceStatus>("/api/sources/status"),
        ]);
        if (!cancelled) {
          setData({ prices, usage, status });
          setLastRefresh(new Date());
          setError(false);
        }
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const currentPrice = data.prices?.data.intervals.find((point, index, all) => {
    const t = new Date(point.timeUtc).getTime();
    const next = all[index + 1] ? new Date(all[index + 1].timeUtc).getTime() : t + 15 * 60 * 1000;
    return Date.now() >= t && Date.now() < next;
  });

  return (
    <div className="kitchen-display">
      <header className="display-header">
        <div><span className="display-brand">NEXUS</span><h1>Køkken</h1></div>
        <div className="display-clock"><strong>{new Intl.DateTimeFormat("da-DK", { hour: "2-digit", minute: "2-digit" }).format(new Date())}</strong><span>{new Intl.DateTimeFormat("da-DK", { weekday: "long", day: "numeric", month: "long" }).format(new Date())}</span></div>
      </header>

      {error && <div className="display-alert">Kunne ikke opdatere alle kilder. Viser seneste kendte data.</div>}

      <main className="display-grid">
        <section className="display-card display-card--wide">
          <div className="display-card-header"><div><span className="display-kicker">Strøm</span><h2>Pris næste 24 timer</h2></div><span className={`freshness ${data.prices?.stale ? "stale" : ""}`}>{data.prices?.stale ? "Forsinket" : `Opdateret ${ageLabel(data.prices?.fetchedAt)}`}</span></div>
          {loading ? <div className="display-empty">Henter priser…</div> : <PriceChart envelope={data.prices} />}
        </section>

        <section className="display-card">
          <div className="display-card-header"><div><span className="display-kicker">Forbrug</span><h2>Sidste 7 dage</h2></div><span className={`freshness ${data.usage?.stale ? "stale" : ""}`}>{data.usage ? `Opdateret ${ageLabel(data.usage.fetchedAt)}` : "Ikke klar"}</span></div>
          {loading ? <div className="display-empty">Henter forbrug…</div> : <UsageChart envelope={data.usage} />}
        </section>

        <section className="display-card display-card--compact">
          <span className="display-kicker">Lige nu</span>
          <div className="display-big-number">{currentPrice ? `${currentPrice.approxDkkPerKwh.toFixed(2)} kr` : "—"}</div>
          <p>pr. kWh før tariffer og moms</p>
        </section>

        <section className="display-card display-card--compact">
          <span className="display-kicker">Affald</span>
          <div className="display-big-number display-big-number--text">{data.status?.sources.wasteCalendar.configured ? "Kalender klar" : "Ikke sat op"}</div>
          <p>Næste tømning kommer her, når kalenderfeedet er koblet på.</p>
        </section>

        <section className="display-card display-card--compact">
          <span className="display-kicker">Vejr</span>
          <div className="display-big-number display-big-number--text">Kommer næste</div>
          <p>Vejr bliver næste direkte source efter de tre første integrationer.</p>
        </section>

        <section className="display-card display-card--compact">
          <span className="display-kicker">Varmepumpe</span>
          <div className="display-big-number display-big-number--text">Afventer Mitsubishi</div>
          <p>Plads reserveret til varmt vand og udendørstemperatur.</p>
        </section>
      </main>

      <footer className="display-footer"><span>Nexus display · auto-refresh hvert minut</span><span>{lastRefresh ? `Sidst hentet ${lastRefresh.toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "Venter på første opdatering"}</span></footer>
    </div>
  );
}

export default KitchenDisplay;
