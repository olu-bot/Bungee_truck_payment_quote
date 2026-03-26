export async function geocodeLocation(location: string): Promise<{ lat: number; lng: number } | null> {
  const q = location.trim();
  if (!q) return null;
  const res = await fetch(`/api/geocode?location=${encodeURIComponent(q)}`);
  if (!res.ok) return null;
  return res.json();
}

export async function getOSRMRoute(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): Promise<{ distanceKm: number; durationMinutes: number } | null> {
  const params = new URLSearchParams({
    fromLat: String(fromLat),
    fromLng: String(fromLng),
    toLat: String(toLat),
    toLng: String(toLng),
  });
  const res = await fetch(`/api/distance?${params}`);
  if (!res.ok) return null;
  return res.json();
}

/**
 * Fetch all leg distances in a single OSRM call.
 * Returns an array of { distanceKm, durationMinutes } — one per consecutive pair.
 * Falls back to null if the call fails.
 */
export async function getMultiWaypointDistances(
  waypoints: { lat: number; lng: number }[],
): Promise<{ distanceKm: number; durationMinutes: number }[] | null> {
  if (waypoints.length < 2) return null;
  try {
    const res = await fetch("/api/distances", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ waypoints }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.legs ?? null;
  } catch {
    return null;
  }
}
