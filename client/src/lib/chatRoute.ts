import type { RouteStop } from "@shared/schema";

export type ChatRouteResult = {
  success: boolean;
  message: string;
  locations: string[];
  stops?: RouteStop[];
  returnDistance?: { distanceKm: number; durationMinutes: number } | null;
};

export async function processChatRoute(message: string): Promise<ChatRouteResult> {
  const res = await fetch("/api/chat-route", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  const data = (await res.json()) as ChatRouteResult;
  if (!res.ok) {
    throw new Error((data as unknown as { error?: string }).error || "Chat route failed");
  }
  return data;
}
