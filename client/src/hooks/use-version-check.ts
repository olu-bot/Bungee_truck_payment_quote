import { useState, useEffect, useRef } from "react";

const POLL_INTERVAL_MS = 3 * 60 * 1000; // check every 3 minutes
const VERSION_URL = `${import.meta.env.BASE_URL ?? "/connect/"}version.json`;

/** The version baked into this bundle at build time. */
const CURRENT_VERSION = import.meta.env.VITE_APP_VERSION ?? "";

/**
 * Polls version.json every 3 minutes.
 * Returns the latest deployed version string when it differs from the
 * version baked into the running bundle — undefined otherwise.
 */
export function useVersionCheck(): string | undefined {
  const [newVersion, setNewVersion] = useState<string | undefined>(undefined);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function check() {
    if (!CURRENT_VERSION) return; // dev build — skip
    try {
      const res = await fetch(`${VERSION_URL}?t=${Date.now()}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as { version?: string };
      const deployed = data.version ?? "";
      if (deployed && deployed !== CURRENT_VERSION) {
        setNewVersion(deployed);
      }
    } catch {
      // Network error — ignore silently
    }
  }

  useEffect(() => {
    // First check after 30 s (give the page time to fully load)
    const initial = setTimeout(check, 30_000);
    timerRef.current = setInterval(check, POLL_INTERVAL_MS);
    return () => {
      clearTimeout(initial);
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return newVersion;
}
