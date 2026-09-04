import type { ReactNode } from "react";
import { useElementSize } from "../data/useElementSize";
import type { ElementSize } from "../data/useElementSize";

type Props = {
  /** Extra class names for the frame element. The frame owns the chart's height via CSS. */
  className?: string;
  /** Accessible name for the drawn chart. */
  label: string;
  /** Receives the frame's pixel size and returns SVG children drawn in pixel coordinates. */
  children: (size: ElementSize) => ReactNode;
};

/**
 * The one chart container in Nexus.
 *
 * Rules (see docs/UI-GUIDE.md):
 * - The frame's height comes from CSS, never from the SVG aspect ratio.
 * - The SVG is sized to the frame in pixels; coordinates passed to `children`
 *   are pixels, so axis text and stroke widths are constant on every screen.
 * - Nothing is drawn until the frame has been measured, which avoids a
 *   first-paint jump.
 */
export default function ChartFrame({ className, label, children }: Props) {
  const { ref, width, height } = useElementSize<HTMLDivElement>();
  const ready = width > 8 && height > 8;
  return <div ref={ref} className={`chart-frame${className ? ` ${className}` : ""}`}>
    {ready && <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>{children({ width, height })}</svg>}
  </div>;
}
