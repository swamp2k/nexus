import { useEffect, useMemo, useState } from "react";

type PricePoint = { timeUtc: string; eurPerMwh: number; approxDkkPerKwh: number };
type EnergyResponse = {
  data: {
    source: "Energi Data Service";
    area: "DK1" | "DK2";
    resolutionMinutes: 15;
    intervals: PricePoint[];
  };
  fetchedAt: string;
  stale: boolean;
};

type HourWindow = { start: string; average: number };
const TIME_ZONE = "Europe/Copenhagen";

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("da-DK", { hour: "2-digit", minute: "2-digit", timeZone: TIME_ZONE }).format(new Date(value));
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("da-DK", { weekday: "long", day: "numeric", month: "long", timeZone: TIME_ZONE }).format(new Date(value));
}

function localDateKey(value: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: TIME_ZONE }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function ageLabel(value: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 60000));
  if (minutes < 1) return "lige nu";
  if (minutes < 60) return `${minutes} min siden`;
  return `${Math.round(minutes / 60)} t siden`;
}

function rollingHours(points: PricePoint[]): HourWindow[] {
  const result: HourWindow[] = [];
  for (let index = 0; index + 3 < points.length; index += 1) {
    const slice = points.slice(index, index + 4);
    result.push({ start: points[index].timeUtc, average: slice.reduce((sum, point) => sum + point.approxDkkPerKwh, 0) / 4 });
  }
  return result;
}

function PriceChart({ points }: { points: PricePoint[] }) {
  if (points.length === 0) return <div className="electricity-empty">Ingen priser til grafen.</div>;
  const width = 1000;
  const height = 260;
  const padX = 24;
  const padY = 28;
  const values = points.map((point) => point.approxDkkPerKwh);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(0.01, max - min);
  const path = points.map((point, index) => {
    const x = padX + (index / Math.max(1, points.length - 1)) * (width - padX * 2);
    const y = height - padY - ((point.approxDkkPerKwh - min) / span) * (height - padY * 2);
    return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  return (
    <div className="electricity-chart-wrap">
      <svg className="electricity-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Spotpris de næste 24 timer">
        <line x1={padX} y1={height - padY} x2={width - padX} y2={height - padY} className="electricity-gridline" />
        <line x1={padX} y1={height / 2} x2={width - padX} y2={height / 2} className="electricity-gridline" />
        <path d={path} className="electricity-line" />
      </svg>
      <div className="electricity-axis"><span>{formatTime(points[0].timeUtc)}</span><span>{formatTime(points[Math.floor(points.length / 2)].timeUtc)}</span><span>{formatTime(points[points.length - 1].timeUtc)}</span></div>
    </div>
  );
}

export default function ElectricityPage() {
  const [response, setResponse] = useState<EnergyResponse | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  async function refresh() {
    try {
      const result = await fetch("/api/sources/energy/prices", { credentials: "same-origin", cache: "no-store" });
      if (!result.ok) throw new Error(`HTTP ${result.status}`);
      setResponse(await result.json() as EnergyResponse);
      setState("ready");
    } catch {
      setState("error");
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  const metrics = useMemo(() => {
    if (!response) return null;
    const now = Date.now();
    const future = response.data.intervals.filter((point) => {
      const time = Date.parse(point.timeUtc);
      return time >= now - 15 * 60000 && time <= now + 24 * 60 * 60000;
    });
    const current = future.find((point, index) => {
      const start = Date.parse(point.timeUtc);
      const next = future[index + 1] ? Date.parse(future[index + 1].timeUtc) : start + 15 * 60000;
      return now >= start && now < next;
    }) ?? future[0] ?? null;
    const windows = rollingHours(future);
    const cheapest = windows.length ? windows.reduce((best, item) => item.average < best.average ? item : best) : null;
    const highest = windows.length ? windows.reduce((best, item) => item.average > best.average ? item : best) : null;
    return { future, current, cheapest, highest };
  }, [response]);

  const days = useMemo(() => {
    if (!response) return [];
    const grouped = new Map<string, PricePoint[]>();
    for (const point of response.data.intervals) {
      const key = localDateKey(point.timeUtc);
      const list = grouped.get(key) ?? [];
      list.push(point);
      grouped.set(key, list);
    }
    const todayKey = localDateKey(new Date().toISOString());
    return Array.from(grouped.entries()).filter(([key]) => key >= todayKey).slice(0, 2).map(([key, points]) => {
      const values = points.map((point) => point.approxDkkPerKwh);
      return { key, label: formatDate(points[0].timeUtc), min: Math.min(...values), max: Math.max(...values), average: values.reduce((sum, value) => sum + value, 0) / values.length };
    });
  }, [response]);

  if (state === "loading") return <section className="electricity-state">Henter elpriser…</section>;
  if (state === "error" || !response || !metrics) {
    return <section className="electricity-state"><strong>Elpriserne kunne ikke hentes.</strong><button className="secondary-action" type="button" onClick={() => void refresh()}>Prøv igen</button></section>;
  }

  return (
    <section className="electricity-page" aria-labelledby="electricity-heading">
      <article className="electricity-hero">
        <div>
          <p className="section-label">Energi Data Service · {response.data.area}</p>
          <h2 id="electricity-heading">{metrics.current ? `${metrics.current.approxDkkPerKwh.toFixed(2)} kr/kWh` : "—"}</h2>
          <strong>Spotpris lige nu</strong>
          <p>Opdateret {ageLabel(response.fetchedAt)}{response.stale ? " · viser seneste kendte data" : ""}</p>
        </div>
        <div className="electricity-hero-metrics">
          <div><span>Billigste time</span><strong>{metrics.cheapest ? `${metrics.cheapest.average.toFixed(2)} kr` : "—"}</strong><small>{metrics.cheapest ? `fra ${formatTime(metrics.cheapest.start)}` : ""}</small></div>
          <div><span>Dyreste time</span><strong>{metrics.highest ? `${metrics.highest.average.toFixed(2)} kr` : "—"}</strong><small>{metrics.highest ? `fra ${formatTime(metrics.highest.start)}` : ""}</small></div>
        </div>
      </article>

      <article className="electricity-card">
        <div className="electricity-card-heading"><div><p className="section-label">Næste døgn</p><h3>Spotpris hvert 15. minut</h3></div><button className="secondary-action" type="button" onClick={() => void refresh()}>Opdatér</button></div>
        <PriceChart points={metrics.future} />
        <div className="electricity-price-strip">
          {metrics.future.map((point) => <div className="electricity-price-cell" key={point.timeUtc}><span>{formatTime(point.timeUtc)}</span><strong>{point.approxDkkPerKwh.toFixed(2)}</strong></div>)}
        </div>
      </article>

      <div className="electricity-days">
        {days.map((day) => <article className="electricity-day-card" key={day.key}><p className="section-label">{day.label}</p><div><span>Laveste</span><strong>{day.min.toFixed(2)} kr</strong></div><div><span>Gennemsnit</span><strong>{day.average.toFixed(2)} kr</strong></div><div><span>Højeste</span><strong>{day.max.toFixed(2)} kr</strong></div></article>)}
      </div>

      <p className="electricity-note">Priserne er spotpriser omregnet til DKK/kWh. Moms, nettariffer, afgifter og elselskabets tillæg er ikke med endnu.</p>
    </section>
  );
}
