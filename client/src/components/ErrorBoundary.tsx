import React from "react";

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

// Session-storage key shared with the root boundary so both respect the same throttle window.
const CHUNK_RELOAD_TS_KEY = "bungee_chunk_reload_ts_v2";
const THROTTLE_MS = 60_000;

function isChunkLoadError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err ?? "")).toLowerCase();
  return (
    msg.includes("chunkloaderror") ||
    msg.includes("loading chunk") ||
    msg.includes("failed to fetch dynamically imported module") ||
    msg.includes("importing a module script failed")
  );
}

function tryGetTs(): number {
  try {
    return Number(sessionStorage.getItem(CHUNK_RELOAD_TS_KEY) ?? "0");
  } catch {
    return 0;
  }
}

function setTs(): void {
  try {
    sessionStorage.setItem(CHUNK_RELOAD_TS_KEY, String(Date.now()));
  } catch {
    // ignore
  }
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info.componentStack);

    // Stale-chunk error after a deployment → silently reload once so the user
    // gets the fresh bundle without ever seeing an error screen.
    if (isChunkLoadError(error)) {
      const lastTs = tryGetTs();
      if (Date.now() - lastTs >= THROTTLE_MS) {
        setTs();
        window.location.reload();
      }
    }
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    // Chunk error: stay blank while the reload is in flight — nothing to show.
    if (isChunkLoadError(error)) return null;

    // Any other error: show a friendly fallback with a manual reload button.
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 px-4">
        <div className="text-center space-y-2">
          <h2 className="text-sm font-semibold text-slate-900">Something went wrong</h2>
          <p className="text-xs text-slate-500">An unexpected error occurred. Please try reloading the page.</p>
        </div>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 text-sm font-medium rounded-md bg-orange-500 hover:bg-orange-600 text-white transition-colors"
        >
          Reload page
        </button>
      </div>
    );
  }
}
