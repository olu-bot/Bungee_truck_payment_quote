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
