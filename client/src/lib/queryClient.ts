import { QueryClient } from "@tanstack/react-query";
import { apiUrl } from "@/lib/apiUrl";
import { auth } from "@/lib/firebase";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
      queryFn: async ({ queryKey }) => {
        const path = queryKey[0];
        if (typeof path === "string" && path.startsWith("/api/")) {
          const token = await auth?.currentUser?.getIdToken();
          const headers: Record<string, string> = {};
          if (token) headers["Authorization"] = `Bearer ${token}`;
          const res = await fetch(apiUrl(path), { headers });
          if (!res.ok) throw new Error(await res.text());
          return res.json();
        }
        throw new Error(`Missing queryFn for key: ${JSON.stringify(queryKey)}`);
      },
    },
    mutations: { retry: false },
  },
});

export async function apiRequest(method: string, url: string, data?: unknown): Promise<Response> {
  const resolved = url.startsWith("/api/") ? apiUrl(url) : url;
  const token = await auth?.currentUser?.getIdToken();
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (data) headers["Content-Type"] = "application/json";
  const res = await fetch(resolved, {
    method,
    headers,
    body: data !== undefined ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  if (!res.ok) {
    const text = await res.text();
    let message = text || res.statusText;
    try {
      const j = JSON.parse(text) as { error?: string };
      if (j.error) message = j.error;
    } catch {
      /* keep message */
    }
    throw new Error(message);
  }

  return res;
}
