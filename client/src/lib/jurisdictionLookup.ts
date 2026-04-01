/**
 * jurisdictionLookup.ts
 *
 * Maps a lat/lng coordinate to a US state or Canadian province code
 * using a nearest-centroid approach with boundary constraints.
 *
 * Each jurisdiction has one or more centroids. We find the closest
 * centroid within a maximum distance threshold (to reject ocean/Mexico
 * coordinates). For complex shapes, secondary centroids improve accuracy.
 *
 * This is intentionally approximate — accurate enough for IFTA tax
 * allocation where we only need state/province-level resolution.
 */

export const CANADIAN_PROVINCES = new Set([
  "AB", "BC", "MB", "NB", "NL", "NS", "ON", "PE", "QC", "SK",
]);

export function isCanadianProvince(code: string): boolean {
  return CANADIAN_PROVINCES.has(code);
}

type Centroid = { code: string; lat: number; lng: number };

/**
 * Centroids for US states and Canadian provinces.
 * Some states have multiple entries to handle non-convex shapes
 * (e.g., Michigan's two peninsulas, Florida's panhandle, Virginia's eastern shore).
 */
const CENTROIDS: Centroid[] = [
  // US States
  { code: "AL", lat: 32.806671, lng: -86.79113 },
  { code: "AK", lat: 63.588753, lng: -154.493062 },
  { code: "AZ", lat: 34.048928, lng: -111.093731 },
  { code: "AR", lat: 34.969704, lng: -92.373123 },
  { code: "CA", lat: 36.116203, lng: -119.681564 },
  { code: "CA", lat: 34.0, lng: -118.2 },   // SoCal secondary
  { code: "CA", lat: 38.5, lng: -121.5 },   // NorCal secondary
  { code: "CO", lat: 39.059811, lng: -105.311104 },
  { code: "CT", lat: 41.597782, lng: -72.755371 },
  { code: "DE", lat: 39.318523, lng: -75.507141 },
  { code: "DC", lat: 38.897438, lng: -77.026817 },
  { code: "FL", lat: 27.766279, lng: -81.686783 },
  { code: "FL", lat: 25.8, lng: -80.2 },     // South FL
  { code: "FL", lat: 30.4, lng: -85.0 },     // Panhandle
  { code: "GA", lat: 33.040619, lng: -83.643074 },
  { code: "HI", lat: 21.094318, lng: -157.498337 },
  { code: "ID", lat: 44.240459, lng: -114.478773 },
  { code: "IL", lat: 40.349457, lng: -88.986137 },
  { code: "IL", lat: 41.85, lng: -87.65 },   // Chicago metro
  { code: "IN", lat: 39.849426, lng: -86.258278 },
  { code: "IA", lat: 42.011539, lng: -93.210526 },
  { code: "KS", lat: 38.5266, lng: -96.726486 },
  { code: "KY", lat: 37.66814, lng: -84.670067 },
  { code: "LA", lat: 31.169546, lng: -91.867805 },
  { code: "ME", lat: 44.693947, lng: -69.381927 },
  { code: "MD", lat: 39.063946, lng: -76.802101 },
  { code: "MA", lat: 42.230171, lng: -71.530106 },
  { code: "MI", lat: 43.326618, lng: -84.536095 },
  { code: "MI", lat: 46.5, lng: -87.5 },     // Upper Peninsula
  { code: "MI", lat: 42.4, lng: -83.1 },     // Detroit metro
  { code: "MN", lat: 45.694454, lng: -93.900192 },
  { code: "MS", lat: 32.741646, lng: -89.678696 },
  { code: "MO", lat: 38.456085, lng: -92.288368 },
  { code: "MT", lat: 46.921925, lng: -110.454353 },
  { code: "NE", lat: 41.12537, lng: -98.268082 },
  { code: "NV", lat: 38.313515, lng: -117.055374 },
  { code: "NH", lat: 43.452492, lng: -71.563896 },
  { code: "NJ", lat: 40.298904, lng: -74.521011 },
  { code: "NJ", lat: 40.73, lng: -74.17 },   // Northern NJ (Newark metro)
  { code: "NM", lat: 34.97273, lng: -105.032363 },
  { code: "NY", lat: 42.165726, lng: -74.948051 },
  { code: "NY", lat: 40.75, lng: -73.98 },   // NYC metro
  { code: "NC", lat: 35.630066, lng: -79.806419 },
  { code: "ND", lat: 47.528912, lng: -99.784012 },
  { code: "OH", lat: 40.388783, lng: -82.764915 },
  { code: "OK", lat: 35.565342, lng: -96.928917 },
  { code: "OR", lat: 44.572021, lng: -122.070938 },
  { code: "PA", lat: 40.590752, lng: -77.209755 },
  { code: "PA", lat: 39.95, lng: -75.17 },   // Philadelphia metro
  { code: "RI", lat: 41.680893, lng: -71.51178 },
  { code: "SC", lat: 33.856892, lng: -80.945007 },
  { code: "SD", lat: 44.299782, lng: -99.438828 },
  { code: "TN", lat: 35.747845, lng: -86.692345 },
  { code: "TX", lat: 31.054487, lng: -97.563461 },
  { code: "TX", lat: 29.76, lng: -95.37 },   // Houston
  { code: "TX", lat: 32.78, lng: -96.80 },   // Dallas
  { code: "TX", lat: 31.77, lng: -106.44 },  // El Paso
  { code: "UT", lat: 40.150032, lng: -111.862434 },
  { code: "VT", lat: 44.045876, lng: -72.710686 },
  { code: "VA", lat: 37.769337, lng: -78.169968 },
  { code: "WA", lat: 47.400902, lng: -121.490494 },
  { code: "WV", lat: 38.491226, lng: -80.954453 },
  { code: "WI", lat: 44.268543, lng: -89.616508 },
  { code: "WY", lat: 42.755966, lng: -107.30249 },
  // Canadian Provinces
  { code: "AB", lat: 53.9333, lng: -116.5765 },
  { code: "AB", lat: 51.05, lng: -114.07 },  // Calgary
  { code: "BC", lat: 53.7267, lng: -127.6476 },
  { code: "BC", lat: 49.28, lng: -123.12 },  // Vancouver
  { code: "MB", lat: 53.7609, lng: -98.8139 },
  { code: "MB", lat: 49.9, lng: -97.14 },    // Winnipeg
  { code: "NB", lat: 46.5653, lng: -66.4619 },
  { code: "NL", lat: 53.1355, lng: -57.6604 },
  { code: "NL", lat: 47.56, lng: -52.71 },   // St John's
  { code: "NS", lat: 44.6820, lng: -63.7443 },
  { code: "ON", lat: 51.2538, lng: -85.3232 },
  { code: "ON", lat: 43.65, lng: -79.38 },   // Toronto
  { code: "ON", lat: 45.42, lng: -75.70 },   // Ottawa
  { code: "PE", lat: 46.5107, lng: -63.4168 },
  { code: "QC", lat: 52.9399, lng: -73.5491 },
  { code: "QC", lat: 45.50, lng: -73.57 },   // Montreal
  { code: "QC", lat: 46.81, lng: -71.21 },   // Quebec City
  { code: "SK", lat: 52.9399, lng: -106.4509 },
  { code: "SK", lat: 50.45, lng: -104.62 },  // Regina
];

/**
 * Maximum distance in km to consider a match.
 * Rejects ocean/foreign coordinates that are too far from any centroid.
 * 400 km covers the largest US states (TX, MT) from centroid to border.
 */
const MAX_DISTANCE_KM = 400;

/**
 * Haversine distance between two lat/lng points in kilometers.
 */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLng = (lng2 - lng1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Given a lat/lng coordinate, return the US state or Canadian province code.
 * Returns null if the coordinate is outside North America or invalid.
 *
 * @param lat Latitude
 * @param lng Longitude
 * @returns Two-letter state/province code (e.g., "NY", "ON") or null
 */
export function getJurisdiction(lat: number, lng: number): string | null {
  if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) return null;

  // Quick bounds check: reject points clearly outside US/CA
  // US/CA spans roughly lat 24-72, lng -141 to -52
  if (lat < 24 || lat > 72 || lng < -141 || lng > -52) return null;

  let bestCode: string | null = null;
  let bestDist = Infinity;

  for (const c of CENTROIDS) {
    const d = haversineKm(lat, lng, c.lat, c.lng);
    if (d < bestDist) {
      bestDist = d;
      bestCode = c.code;
    }
  }

  if (bestDist > MAX_DISTANCE_KM) return null;

  return bestCode;
}
