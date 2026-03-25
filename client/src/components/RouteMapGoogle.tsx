import { useMemo } from "react";
import type { RouteStop } from "@shared/schema";

/**
 * Map preview using Google Maps Embed API.
 *
 * Priority:
 * 1) If `VITE_GOOGLE_MAPS_API_KEY` is set: show directions (route polyline) or
 *    a centered city view by default.
 * 2) Otherwise: fallback to an OpenStreetMap bbox embed (best-effort).
 */
export function RouteMapGoogle({
  stops,
  fallbackCenter,
}: {
  stops: RouteStop[];
  fallbackCenter?: string;
}) {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

  function pointParam(s: RouteStop): string {
    const rawLat = s.lat as unknown;
    const rawLng = s.lng as unknown;
    const lat = typeof rawLat === "number" ? rawLat : Number(rawLat);
    const lng = typeof rawLng === "number" ? rawLng : Number(rawLng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return `${lat},${lng}`;
    return (s.location ?? "").trim();
  }

  const osmBboxSrc = useMemo(() => {
    const pts = stops
      .map((s) => {
        const rawLat = (s as unknown as { lat?: unknown }).lat;
        const rawLng = (s as unknown as { lng?: unknown }).lng;
        const lat = typeof rawLat === "number" ? rawLat : Number(rawLat);
        const lng = typeof rawLng === "number" ? rawLng : Number(rawLng);
        return { lat, lng };
      })
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));

    if (pts.length === 0) return null;

    const lons = pts.map((s) => s.lng);
    const lats = pts.map((s) => s.lat);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);

    const padLon = Math.max((maxLon - minLon) * 0.15, 0.02);
    const padLat = Math.max((maxLat - minLat) * 0.15, 0.02);

    const left = minLon - padLon;
    const right = maxLon + padLon;
    const bottom = minLat - padLat;
    const top = maxLat + padLat;

    return `https://www.openstreetmap.org/export/embed.html?bbox=${left}%2C${bottom}%2C${right}%2C${top}&layer=mapnik`;
  }, [stops]);

  const directionsSrc = useMemo(() => {
    const filledStops = stops.filter((s) => pointParam(s).length > 0);
    if (filledStops.length < 2) return null;
    if (!apiKey) return null;

    const origin = pointParam(filledStops[0]!);
    const destination = pointParam(filledStops[filledStops.length - 1]!);
    const waypoints = filledStops
      .slice(1, -1)
      .map((s) => pointParam(s))
      .filter((x) => x.length > 0)
      .join("|");

    // Draws route polyline between stops (including waypoints).
    const base = `key=${encodeURIComponent(apiKey)}&origin=${encodeURIComponent(
      origin
    )}&destination=${encodeURIComponent(destination)}&mode=${encodeURIComponent("driving")}`;

    const waypointsPart = waypoints ? `&waypoints=${encodeURIComponent(waypoints)}` : "";
    return `https://www.google.com/maps/embed/v1/directions?${base}${waypointsPart}`;
  }, [stops, apiKey]);

  const defaultMapSrc = useMemo(() => {
    if (!apiKey) return null;
    const q = (fallbackCenter ?? stops[0]?.location ?? "").trim();
    if (!q) return null;

    const params = new URLSearchParams({ key: apiKey, q });
    return `https://www.google.com/maps/embed/v1/place?${params.toString()}`;
  }, [apiKey, fallbackCenter, stops]);

  const src = directionsSrc ?? defaultMapSrc ?? osmBboxSrc;

  if (!src) {
    return (
      <div className="h-64 w-full rounded-md border border-dashed border-border bg-muted/30 flex items-center justify-center text-xs text-muted-foreground px-4 text-center">
        Map preview unavailable. Add locations to build a route.
      </div>
    );
  }

  return (
    <iframe
      title="Route map"
      className="h-64 w-full rounded-md border border-border"
      src={src}
      referrerPolicy="no-referrer-when-downgrade"
      loading="lazy"
    />
  );
}
