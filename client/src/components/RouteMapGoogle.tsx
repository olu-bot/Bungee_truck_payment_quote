import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RouteStop } from "@shared/schema";

/**
 * Map preview: when `VITE_GOOGLE_MAPS_API_KEY` is set, uses the Maps JavaScript API
 * to draw driving directions and labeled markers.
 *
 * - **Yard** stops (`type === "yard"`) use label **Y** (home base / return).
 * - **Route** stops (pickup, delivery, middle stops) use **A, B, C, …** in order.
 *   So with yard + pickup + delivery + return yard you see **Y → A → B → Y**, and the
 *   main haul reads **A → B**, not C → D.
 * Falls back to Embed / OSM when the JS API is unavailable or stops lack coordinates.
 */

function getLatLng(s: RouteStop): { lat: number; lng: number } | null {
  const rawLat = s.lat as unknown;
  const rawLng = s.lng as unknown;
  const lat = typeof rawLat === "number" ? rawLat : Number(rawLat);
  const lng = typeof rawLng === "number" ? rawLng : Number(rawLng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  return null;
}

function labelForRouteStopIndex(index: number): string {
  if (index < 26) return String.fromCharCode(65 + index);
  return String(index + 1);
}

let mapsApiLoadPromise: Promise<void> | null = null;

function mapsReady(): boolean {
  return Boolean((window as unknown as { google?: { maps?: unknown } }).google?.maps);
}

function loadMapsJavaScriptApi(apiKey: string): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (mapsReady()) return Promise.resolve();
  if (mapsApiLoadPromise) return mapsApiLoadPromise;

  mapsApiLoadPromise = new Promise((resolve, reject) => {
    const done = () => {
      if (mapsReady()) resolve();
    };

    let s = document.getElementById("google-maps-js-api") as HTMLScriptElement | null;
    if (!s) {
      s = document.createElement("script");
      s.id = "google-maps-js-api";
      s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}`;
      s.async = true;
      s.onload = () => done();
      s.onerror = () => {
        mapsApiLoadPromise = null;
        reject(new Error("Failed to load Google Maps"));
      };
      document.head.appendChild(s);
    }

    const start = Date.now();
    const poll = window.setInterval(() => {
      if (mapsReady()) {
        window.clearInterval(poll);
        resolve();
        return;
      }
      if (Date.now() - start > 20000) {
        window.clearInterval(poll);
        mapsApiLoadPromise = null;
        reject(new Error("Google Maps API load timeout"));
      }
    }, 50);
  });

  return mapsApiLoadPromise;
}

// Maps JS API loaded at runtime — avoid @types/google.maps dependency
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MapsApi = any;

function getMapsApi(): MapsApi {
  return (window as unknown as { google: { maps: MapsApi } }).google.maps;
}

function RouteMapJs({
  stops,
  apiKey,
  onFallback,
}: {
  stops: RouteStop[];
  apiKey: string;
  onFallback: () => void;
}) {
  const elRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = elRef.current;
    if (!el || stops.length === 0) return;

    let cancelled = false;
    const markers: MapsApi[] = []; // Marker instances

    (async () => {
      try {
        await loadMapsJavaScriptApi(apiKey);
        if (cancelled || !elRef.current) return;
        const maps = getMapsApi();

        const coords = stops
          .map((s) => ({ stop: s, ll: getLatLng(s) }))
          .filter((x): x is { stop: RouteStop; ll: { lat: number; lng: number } } => x.ll !== null);

        if (coords.length === 0) {
          onFallback();
          return;
        }

        const map = new maps.Map(el, {
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
        });

        let routeLetterIdx = 0;
        coords.forEach(({ stop, ll }) => {
          const text =
            stop.type === "yard" ? "Y" : labelForRouteStopIndex(routeLetterIdx++);
          const m = new maps.Marker({
            position: ll,
            map,
            label: {
              text,
              color: "#ffffff",
              fontWeight: "700",
              fontSize: "12px",
            },
            title:
              stop.type === "yard"
                ? `Yard: ${stop.location || "—"}`
                : `Stop ${text}: ${stop.location || "—"}`,
            optimized: true,
          });
          markers.push(m);
        });

        if (coords.length === 1) {
          map.setCenter(coords[0]!.ll);
          map.setZoom(11);
          return;
        }

        const directionsService = new maps.DirectionsService();
        const directionsRenderer = new maps.DirectionsRenderer({
          map,
          suppressMarkers: true,
          preserveViewport: false,
        });

        const origin = coords[0]!.ll;
        const destination = coords[coords.length - 1]!.ll;
        const waypoints =
          coords.length > 2
            ? coords.slice(1, -1).map(({ ll }) => ({
                location: ll,
                stopover: true,
              }))
            : [];

        directionsService.route(
          {
            origin,
            destination,
            waypoints,
            travelMode: maps.TravelMode.DRIVING,
          },
          (
            result: unknown,
            status: string,
          ) => {
            if (cancelled) return;
            if (status === "OK" && result) {
              directionsRenderer.setDirections(result);
              return;
            }
            const bounds = new maps.LatLngBounds();
            coords.forEach(({ ll }) => bounds.extend(ll));
            map.fitBounds(bounds);
          },
        );
      } catch {
        onFallback();
      }
    })();

    return () => {
      cancelled = true;
      markers.forEach((m) => m.setMap(null));
      if (elRef.current) elRef.current.innerHTML = "";
    };
  }, [stops, apiKey, onFallback]);

  return <div ref={elRef} className="h-64 w-full rounded-md border border-border" />;
}

export function RouteMapGoogle({
  stops,
  fallbackCenter,
}: {
  stops: RouteStop[];
  fallbackCenter?: string;
}) {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
  const [iframeFallback, setIframeFallback] = useState(false);

  const coordsStops = useMemo(() => {
    return stops.filter((s) => getLatLng(s) !== null);
  }, [stops]);

  useEffect(() => {
    setIframeFallback(false);
  }, [stops]);

  const onJsMapFallback = useCallback(() => setIframeFallback(true), []);

  const useJsMap = Boolean(apiKey && coordsStops.length >= 1 && !iframeFallback);

  function pointParam(s: RouteStop): string {
    const ll = getLatLng(s);
    if (ll) return `${ll.lat},${ll.lng}`;
    return (s.location ?? "").trim();
  }

  const osmBboxSrc = useMemo(() => {
    const pts = stops
      .map((s) => getLatLng(s))
      .filter((p): p is { lat: number; lng: number } => p !== null);

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

    const base = `key=${encodeURIComponent(apiKey)}&origin=${encodeURIComponent(
      origin,
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

  if (useJsMap && apiKey) {
    return (
      <RouteMapJs stops={coordsStops} apiKey={apiKey} onFallback={onJsMapFallback} />
    );
  }

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
