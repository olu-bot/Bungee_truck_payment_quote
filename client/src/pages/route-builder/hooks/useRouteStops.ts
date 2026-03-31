import { useState, useRef, useCallback, useMemo } from "react";
import { geocodeLocation, getOSRMRoute, getMultiWaypointDistances } from "@/lib/geo";
import type { RouteStop, Yard } from "@shared/schema";

// ── Stop ID generator ──────────────────────────────────────────
let stopIdCounter = 0;
export function nextStopId(): string {
  return `stop-${Date.now()}-${++stopIdCounter}`;
}

export type FormStop = { id: string; location: string; dockMinutes: number };

/**
 * Extract a city/region from a detailed address string.
 * Given "123 Industrial Rd, Suite 5, Toronto, ON M5V 2T6"
 * → tries "Toronto, ON M5V 2T6" then "Toronto, ON" etc.
 * Falls back to the last comma-separated segment.
 */
function extractCityFromAddress(address: string): string | null {
  const parts = address.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 1) return null;
  for (let i = 1; i < parts.length; i++) {
    const candidate = parts.slice(i).join(", ");
    if (candidate.length >= 3) return candidate;
  }
  return null;
}

async function getDistance(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): Promise<{ distanceKm: number; durationMinutes: number } | null> {
  return getOSRMRoute(fromLat, fromLng, toLat, toLng);
}

const CA_PROVINCES = new Set(["AB", "BC", "MB", "NB", "NL", "NS", "ON", "PE", "QC", "SK"]);

export function useRouteStops(defaultDockMinutes: number) {
  // ── Form stops (user input) ────────────────────────────────────
  const [formStops, setFormStops] = useState<FormStop[]>([
    { id: nextStopId(), location: "", dockMinutes: defaultDockMinutes },
    { id: nextStopId(), location: "", dockMinutes: defaultDockMinutes },
  ]);
  const formStopsRef = useRef<FormStop[]>(formStops);
  formStopsRef.current = formStops;
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // Convenience getters
  const origin = formStops[0]?.location ?? "";
  const destination = formStops[formStops.length - 1]?.location ?? "";

  // ── Built stops (geocoded, with distances) ─────────────────────
  const [stops, setStops] = useState<RouteStop[]>([]);
  const stopsRef = useRef<RouteStop[]>([]);
  stopsRef.current = stops;

  // ── Cross-border detection ─────────────────────────────────────
  const isCrossBorder = useMemo(() => {
    if (stops.length < 2) return false;
    const locations = stops.map((s) => s.location.toUpperCase());
    let hasCA = false;
    let hasUS = false;
    for (const loc of locations) {
      for (const prov of CA_PROVINCES) {
        if (loc.includes(`, ${prov}`) || loc.endsWith(` ${prov}`)) { hasCA = true; break; }
      }
      if (!hasCA || hasUS) {
        const parts = loc.split(",").map((p) => p.trim());
        const last = parts[parts.length - 1];
        if (last && last.length === 2 && !CA_PROVINCES.has(last)) hasUS = true;
        if (loc.includes("USA") || loc.includes("UNITED STATES")) hasUS = true;
      }
      if (loc.includes("CANADA") || loc.includes("ONTARIO") || loc.includes("QUEBEC") || loc.includes("ALBERTA")) hasCA = true;
    }
    return hasCA && hasUS;
  }, [stops]);

  // ── Populate form from location strings (used by chat + lane load) ──
  const populateFormFromLocations = useCallback(
    (locations: string[]) => {
      const newStops: FormStop[] = locations.map((loc) => ({
        id: nextStopId(),
        location: loc,
        dockMinutes: defaultDockMinutes,
      }));
      setFormStops(newStops);
      return newStops;
    },
    [defaultDockMinutes],
  );

  // ── Build RouteStop[] from form values ─────────────────────────
  const buildStopsFromForm = useCallback(
    async (
      fStops: FormStop[],
      yard: Yard | null,
      _doReturn: boolean,
    ): Promise<RouteStop[]> => {
      const locations: { name: string; type: RouteStop["type"]; dockMinutes: number; knownLat?: number; knownLng?: number }[] = [];

      const yardLat = yard?.lat ?? undefined;
      const yardLng = yard?.lng ?? undefined;

      for (let i = 0; i < fStops.length; i++) {
        const s = fStops[i];
        if (!s.location.trim()) continue;
        const type: RouteStop["type"] = i === 0 ? "pickup" : i === fStops.length - 1 ? "delivery" : "stop";
        locations.push({ name: s.location.trim(), type, dockMinutes: s.dockMinutes });
      }

      if (yard) {
        locations.push({ name: yard.address || yard.name, type: "yard", dockMinutes: 0, knownLat: yardLat, knownLng: yardLng });
      }

      if (locations.length < 2) return [];

      const geocoded = await Promise.all(
        locations.map(async (loc) => {
          if (loc.knownLat != null && loc.knownLng != null && Number.isFinite(loc.knownLat) && Number.isFinite(loc.knownLng)) {
            return { ...loc, lat: loc.knownLat, lng: loc.knownLng };
          }
          let coords = await geocodeLocation(loc.name);
          if (!coords) {
            const cityPart = extractCityFromAddress(loc.name);
            if (cityPart && cityPart !== loc.name) {
              coords = await geocodeLocation(cityPart);
            }
          }
          return { ...loc, lat: coords?.lat, lng: coords?.lng };
        }),
      );

      const validWaypoints: { lat: number; lng: number }[] = [];
      const waypointIndices: number[] = [];
      for (let i = 0; i < geocoded.length; i++) {
        const g = geocoded[i];
        if (g.lat != null && g.lng != null) {
          validWaypoints.push({ lat: g.lat, lng: g.lng });
          waypointIndices.push(i);
        }
      }

      let legDistances: { distanceKm: number; durationMinutes: number }[] | null = null;
      if (validWaypoints.length >= 2) {
        legDistances = await getMultiWaypointDistances(validWaypoints);
        console.log("[buildStops] Multi-waypoint distances:", legDistances);
      }

      const result: RouteStop[] = [];
      for (let i = 0; i < geocoded.length; i++) {
        const g = geocoded[i];
        let distanceFromPrevKm = 0;
        let driveMinutesFromPrev = 0;

        if (i > 0) {
          const prevWpIdx = waypointIndices.indexOf(i - 1);
          const curWpIdx = waypointIndices.indexOf(i);
          if (prevWpIdx >= 0 && curWpIdx >= 0 && curWpIdx === prevWpIdx + 1 && legDistances && legDistances[prevWpIdx]) {
            distanceFromPrevKm = legDistances[prevWpIdx].distanceKm;
            driveMinutesFromPrev = legDistances[prevWpIdx].durationMinutes;
          } else if (g.lat != null && g.lng != null) {
            const prev = geocoded[i - 1];
            if (prev.lat != null && prev.lng != null) {
              const dist = await getDistance(prev.lat, prev.lng, g.lat, g.lng);
              if (dist) {
                distanceFromPrevKm = dist.distanceKm;
                driveMinutesFromPrev = dist.durationMinutes;
              }
            }
          }
        }

        result.push({
          id: nextStopId(),
          type: g.type,
          location: g.name,
          lat: g.lat,
          lng: g.lng,
          dockTimeMinutes: g.dockMinutes,
          distanceFromPrevKm,
          driveMinutesFromPrev,
        });
      }

      return result;
    },
    [],
  );

  // ── Drag-and-drop handlers ─────────────────────────────────────
  const handleDragStart = useCallback((idx: number, e: React.DragEvent) => {
    setDragIdx(idx);
    e.dataTransfer.effectAllowed = "move";
  }, []);

  const handleDragOver = useCallback((idx: number, e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverIdx(idx);
  }, []);

  const handleDragLeave = useCallback(() => setDragOverIdx(null), []);

  const handleDrop = useCallback((idx: number, e: React.DragEvent) => {
    e.preventDefault();
    if (dragIdx != null && dragIdx !== idx) {
      setFormStops((prev) => {
        const copy = [...prev];
        const [moved] = copy.splice(dragIdx!, 1);
        copy.splice(idx, 0, moved);
        return copy;
      });
    }
    setDragIdx(null);
    setDragOverIdx(null);
  }, [dragIdx]);

  const handleDragEnd = useCallback(() => {
    setDragIdx(null);
    setDragOverIdx(null);
  }, []);

  const addStop = useCallback(() => {
    setFormStops((prev) => [
      ...prev,
      { id: nextStopId(), location: "", dockMinutes: defaultDockMinutes },
    ]);
  }, [defaultDockMinutes]);

  const removeStop = useCallback((idx: number) => {
    setFormStops((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const updateStopLocation = useCallback((idx: number, location: string) => {
    setFormStops((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, location } : s)),
    );
  }, []);

  const swapOriginDest = useCallback(() => {
    setFormStops((prev) => {
      if (prev.length < 2) return prev;
      const copy = [...prev];
      const first = copy[0];
      copy[0] = copy[copy.length - 1];
      copy[copy.length - 1] = first;
      return copy;
    });
  }, []);

  return {
    // Form state
    formStops,
    setFormStops,
    formStopsRef,
    dragIdx,
    dragOverIdx,
    origin,
    destination,

    // Built stops
    stops,
    setStops,
    stopsRef,

    // Computed
    isCrossBorder,

    // Actions
    populateFormFromLocations,
    buildStopsFromForm,
    addStop,
    removeStop,
    updateStopLocation,
    swapOriginDest,

    // Drag handlers
    handleDragStart,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleDragEnd,
  };
}
