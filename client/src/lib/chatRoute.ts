import type { RouteStop } from "@shared/schema";

export type CargoItem = {
  dimensions: string;
  weightKg: number | null;
  pieces: number | null;
  description: string | null;
};

export type ShipmentInfo = {
  referenceNumber: string | null;
  cargo: CargoItem[];
  totalWeightKg: number | null;
  totalPieces: number | null;
  productName: string | null;
  pickupAddress: string | null;
  deliveryAddress: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
};

export type FreightMeta = {
  equipment: string | null;
  pickupDetails: string | null;
  deliveryDetails: string | null;
};

export type ChatRouteResult = {
  success: boolean;
  message: string;
  locations: string[];
  stops?: RouteStop[];
  returnDistance?: { distanceKm: number; durationMinutes: number } | null;
  shipment?: ShipmentInfo;
  freightMeta?: FreightMeta;
};

const CHAT_TTL_MS = 1000 * 60 * 30; // 30m — matches server cache
// Production may have occasional cold starts / API latency spikes.
const CHAT_TIMEOUT_MS = 60000;
const chatCache = new Map<string, { value: ChatRouteResult; expiresAt: number }>();
const chatInFlight = new Map<string, Promise<ChatRouteResult>>();

function cacheKey(message: string): string {
  return message.trim().replace(/\s+/g, " ").toLowerCase();
}

export async function processChatRoute(message: string, dockTimeMinutes?: number): Promise<ChatRouteResult> {
  const key = cacheKey(message);
  const now = Date.now();
  const hit = chatCache.get(key);
  if (hit && hit.expiresAt > now) {
    if (import.meta.env.DEV) console.debug("[cache hit] client chat-route");
    return hit.value;
  }
  if (hit && hit.expiresAt <= now) chatCache.delete(key);

  const inFlight = chatInFlight.get(key);
  if (inFlight) return inFlight;

  const req = (async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CHAT_TIMEOUT_MS);
    try {
      const res = await fetch("/api/chat-route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, ...(dockTimeMinutes != null ? { dockTimeMinutes } : {}) }),
        signal: ctrl.signal,
      });
      const data = (await res.json()) as ChatRouteResult & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || "Chat route failed");
      }
      chatCache.set(key, { value: data, expiresAt: now + CHAT_TTL_MS });
      return data;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        throw new Error("Route chat timed out. Please try again.");
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  })();

  chatInFlight.set(key, req);
  try {
    return await req;
  } finally {
    chatInFlight.delete(key);
  }
}
