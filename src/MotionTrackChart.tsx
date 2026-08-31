type TrackPoint = Record<string, unknown>;

type Metric = "hr" | "altitude" | "speed";

function num(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function metricValue(point: TrackPoint, metric: Metric): number | null {
  const value = num(point[metric]);
  if (value === null) return null;
  if (metric === "speed") return value > 0 ? 60 / value : null;
  return value;
}

function label(metric: Metric): string {
  if (metric === "hr") return "Puls";
  if (metric === "altitude") return "Højde";
  return "Tempo";
}

function unit(metric: Metric): string {
  if (metric === "hr") return "bpm";
  if (metric === "altitude") return "m";
  return "min/km";
}

export default function MotionTrackChart({ track, metric }: { track: TrackPoint[]; metric: Metric }) {
  const values = track.map((point, index) => ({
    x: num(point.distance) ?? index,
    y: metricValue(point, metric),
  })).filter((point): point is { x: number; y: number } => point.y !== null);

  if (values.length < 2) return null;

  const width = 720;
  const height = 180;
  const padX = 18;
  const padY = 18;
  const minX = Math.min(...values.map((point) => point.x));
  const maxX = Math.max(...values.map((point) => point.x));
  const minY = Math.min(...values.map((point) => point.y));
  const maxY = Math.max(...values.map((point) => point.y));
  const xSpan = Math.max(1, maxX - minX);
  const ySpan = Math.max(1, maxY - minY);
  const points = values.map((point) => {
    const x = padX + ((point.x - minX) / xSpan) * (width - padX * 2);
    const normalized = (point.y - minY) / ySpan;
    const y = metric === "speed"
      ? padY + normalized * (height - padY * 2)
      : height - padY - normalized * (height - padY * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  const avg = values.reduce((sum, point) => sum + point.y, 0) / values.length;

  return (
    <article className="motion-track-chart">
      <div className="motion-track-chart-head">
        <div><p className="section-label">{label(metric)}</p><strong>{avg.toFixed(metric === "hr" ? 0 : 1)} {unit(metric)}</strong></div>
        <span>{minY.toFixed(metric === "hr" ? 0 : 1)}–{maxY.toFixed(metric === "hr" ? 0 : 1)} {unit(metric)}</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${label(metric)} gennem aktiviteten`} preserveAspectRatio="none">
        <polyline points={points} fill="none" stroke="currentColor" strokeWidth="3" vectorEffect="non-scaling-stroke" />
      </svg>
    </article>
  );
}
