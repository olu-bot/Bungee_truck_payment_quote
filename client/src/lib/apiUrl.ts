/**
 * Build an absolute URL to the Express API.
 * Routes live at the site origin (`/api/...`), not under the Vite SPA `base` (e.g. `/connect/`).
 */
export function apiUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  if (typeof window === "undefined") return p;
  return new URL(p, window.location.origin).href;
}
