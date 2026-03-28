/**
 * Vite `base` (import.meta.env.BASE_URL), e.g. `/` or `/connect/`.
 * Use for static assets and legal pages copied to `dist/public`.
 */
export const APP_BASE_URL: string =
  import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;

/** Path to a file under `client/public` after build (e.g. `lottie/x.png`). */
export function publicAsset(path: string): string {
  const p = path.startsWith("/") ? path.slice(1) : path;
  return `${APP_BASE_URL}${p}`;
}
