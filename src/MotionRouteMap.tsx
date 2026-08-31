import { useEffect, useRef } from "react";
import L from "leaflet";

type Point = { position_lat?: unknown; position_long?: unknown };

function numberValue(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export default function MotionRouteMap({ track }: { track: Point[] }) {
  const element = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!element.current) return;
    const coordinates = track.map((point) => {
      const lat = numberValue(point.position_lat);
      const lon = numberValue(point.position_long);
      return lat === null || lon === null ? null : [lat, lon] as L.LatLngTuple;
    }).filter((value): value is L.LatLngTuple => value !== null);
    if (coordinates.length < 2) return;

    const map = L.map(element.current, { zoomControl: true, attributionControl: true });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap",
    }).addTo(map);

    const route = L.polyline(coordinates, { weight: 4, opacity: 0.9 }).addTo(map);
    L.circleMarker(coordinates[0], { radius: 6, weight: 2, fillOpacity: 1 }).bindTooltip("Start").addTo(map);
    L.circleMarker(coordinates[coordinates.length - 1], { radius: 6, weight: 2, fillOpacity: 1 }).bindTooltip("Slut").addTo(map);
    map.fitBounds(route.getBounds(), { padding: [20, 20] });

    window.setTimeout(() => map.invalidateSize(), 0);
    return () => {
      map.remove();
    };
  }, [track]);

  return <div ref={element} className="motion-route-map" aria-label="Kort over aktivitetens rute" />;
}
