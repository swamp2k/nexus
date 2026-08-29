import { useEffect, useMemo, useState } from "react";

type WeatherResponse = {
  data: {
    source: "MET Norway";
    location: {
      label: string;
      latitude: number;
      longitude: number;
    };
    current: {
      time: string;
      temperature: number;
      humidity: number | null;
      windSpeed: number | null;
      windDirection: number | null;
      pressure: number | null;
      symbol: string | null;
      precipitationMm: number | null;
    };
    hourly: Array<{
      time: string;
      temperature: number;
      humidity: number | null;
      windSpeed: number | null;
      windDirection: number | null;
      symbol: string | null;
      precipitationMm: number | null;
      precipitationProbability: number | null;
    }>;
    daily: Array<{
      date: string;
      minTemperature: number;
      maxTemperature: number;
      symbol: string | null;
      maxPrecipitationProbability: number | null;
      windSpeed: number | null;
      windDirection: number | null;
    }>;
  };
  fetchedAt: string;
  expiresAt: string;
  stale: boolean;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
};

function icon(symbol: string | null): string {
  const value = symbol ?? "";
  if (value.includes("thunder")) return "⛈️";
  if (value.includes("sleet")) return "🌨️";
  if (value.includes("snow")) return "❄️";
  if (value.includes("rain")) return "🌧️";
  if (value.includes("fog")) return "🌫️";
  if (value.includes("cloudy")) return "☁️";
  if (value.includes("partlycloudy")) return "⛅";
  if (value.includes("fair")) return "🌤️";
  if (value.includes("clearsky")) return "☀️";
  return "🌡️";
}

function describe(symbol: string | null): string {
  const value = symbol ?? "";
  if (value.includes("thunder")) return "Torden";
  if (value.includes("sleet")) return "Slud";
  if (value.includes("snow")) return "Sne";
  if (value.includes("heavyrain")) return "Kraftig regn";
  if (value.includes("rain")) return "Regn";
  if (value.includes("fog")) return "Tåge";
  if (value.includes("cloudy")) return "Overskyet";
  if (value.includes("partlycloudy")) return "Delvist skyet";
  if (value.includes("fair")) return "Let skyet";
  if (value.includes("clearsky")) return "Klart";
  return "Vejrudsigt";
}

function compassDirection(degrees: number | null): string {
  if (degrees === null || !Number.isFinite(degrees)) return "";
  const directions = ["N", "NNØ", "NØ", "ØNØ", "Ø", "ØSØ", "SØ", "SSØ", "S", "SSV", "SV", "VSV", "V", "VNV", "NV", "NNV"];
  const normalized = ((degrees % 360) + 360) % 360;
  return directions[Math.round(normalized / 22.5) % 16];
}

function windLabel(speed: number | null, direction: number | null): string {
  if (speed === null) return "—";
  const compass = compassDirection(direction);
  return `${speed.toFixed(1)} m/s${compass ? ` ${compass}` : ""}`;
}

function formatHour(value: string): string {
  return new Intl.DateTimeFormat("da-DK", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Copenhagen",
  }).format(new Date(value));
}

function formatDay(value: string): string {
  return new Intl.DateTimeFormat("da-DK", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Europe/Copenhagen",
  }).format(new Date(`${value}T12:00:00+02:00`));
}

function formatAge(value: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 1000));
  if (seconds < 60) return `${seconds} sek siden`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min siden`;
  return `${Math.round(minutes / 60)} t siden`;
}

export default function WeatherPage() {
  const [forecast, setForecast] = useState<WeatherResponse | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  async function refresh() {
    try {
      const response = await fetch("/api/sources/weather", { credentials: "same-origin" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setForecast(await response.json() as WeatherResponse);
      setState("ready");
    } catch {
      setState("error");
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  const current = forecast?.data.current;
  const currentDescription = useMemo(() => describe(current?.symbol ?? null), [current?.symbol]);

  if (state === "loading") {
    return <section className="weather-state">Henter vejrudsigt…</section>;
  }

  if (state === "error" || !forecast || !current) {
    return (
      <section className="weather-state">
        <strong>Vejrudsigten kunne ikke hentes.</strong>
        <button className="secondary-action" type="button" onClick={() => void refresh()}>Prøv igen</button>
      </section>
    );
  }

  return (
    <section className="weather-page" aria-labelledby="weather-heading">
      <article className="weather-now-card">
        <div className="weather-now-copy">
          <p className="section-label">{forecast.data.location.label} · MET Norway</p>
          <div className="weather-now-main">
            <span className="weather-now-icon" aria-hidden="true">{icon(current.symbol)}</span>
            <div>
              <h2 id="weather-heading">{Math.round(current.temperature)}°</h2>
              <strong>{currentDescription}</strong>
            </div>
          </div>
          <p className="weather-freshness">
            Opdateret {formatAge(forecast.fetchedAt)}{forecast.stale ? " · viser seneste kendte data" : ""}
          </p>
        </div>

        <div className="weather-now-metrics">
          <div><span>Fugtighed</span><strong>{current.humidity === null ? "—" : `${Math.round(current.humidity)}%`}</strong></div>
          <div><span>Vind</span><strong>{windLabel(current.windSpeed, current.windDirection)}</strong></div>
          <div><span>Nedbør næste time</span><strong>{current.precipitationMm === null ? "—" : `${current.precipitationMm.toFixed(1)} mm`}</strong></div>
          <div><span>Lufttryk</span><strong>{current.pressure === null ? "—" : `${Math.round(current.pressure)} hPa`}</strong></div>
        </div>
      </article>

      <article className="weather-card">
        <div className="weather-card-heading">
          <div><p className="section-label">Næste døgn</p><h3>Time for time</h3></div>
          <button className="secondary-action" type="button" onClick={() => void refresh()}>Opdatér</button>
        </div>
        <div className="weather-hourly-strip">
          {forecast.data.hourly.map((hour) => (
            <div className="weather-hour" key={hour.time}>
              <span>{formatHour(hour.time)}</span>
              <b aria-hidden="true">{icon(hour.symbol)}</b>
              <strong>{Math.round(hour.temperature)}°</strong>
              <small className="weather-wind">{windLabel(hour.windSpeed, hour.windDirection)}</small>
              <small>{hour.precipitationMm !== null && hour.precipitationMm > 0 ? `${hour.precipitationMm.toFixed(1)} mm` : ""}</small>
            </div>
          ))}
        </div>
      </article>

      <article className="weather-card">
        <div className="weather-card-heading"><div><p className="section-label">7 dage</p><h3>Udsigt</h3></div></div>
        <div className="weather-days">
          {forecast.data.daily.map((day) => (
            <div className="weather-day" key={day.date}>
              <span className="weather-day-date">{formatDay(day.date)}</span>
              <span className="weather-day-icon" aria-hidden="true">{icon(day.symbol)}</span>
              <span className="weather-day-description">{describe(day.symbol)}</span>
              <span className="weather-day-wind">{windLabel(day.windSpeed, day.windDirection)}</span>
              <span className="weather-day-rain">
                {day.maxPrecipitationProbability === null ? "" : `☂ ${Math.round(day.maxPrecipitationProbability)}%`}
              </span>
              <strong>{Math.round(day.maxTemperature)}°</strong>
              <span>{Math.round(day.minTemperature)}°</span>
            </div>
          ))}
        </div>
      </article>
    </section>
  );
}
