import { Component, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { safeStorageGet, safeStorageSet } from "@/lib/safeStorage";
import { reportClientError } from "@/lib/clientErrorBeacon";

const CHUNK_RELOAD_ONCE_KEY = "bungee_chunk_reload_once";
const BOOT_WATCHDOG_KEY = "bungee_boot_watchdog_once";

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message || "";
  return String(err ?? "");
}

function isChunkLoadError(err: unknown): boolean {
  const msg = getErrorMessage(err).toLowerCase();
  return (
    msg.includes("chunkloaderror") ||
    msg.includes("loading chunk") ||
    msg.includes("failed to fetch dynamically imported module")
  );
}

function isMaxStackError(err: unknown): boolean {
  return getErrorMessage(err).toLowerCase().includes("maximum call stack size exceeded");
}

function reloadOnceForChunkError(err: unknown): void {
  if (!isChunkLoadError(err)) return;
  if (safeStorageGet(CHUNK_RELOAD_ONCE_KEY, "session") === "1") return;
  safeStorageSet(CHUNK_RELOAD_ONCE_KEY, "1", "session");
  reportClientError({
    category: "recovery",
    code: "chunk-reload-once",
    message: getErrorMessage(err) || "Chunk load failed",
    detail: "Reloading once for chunk failure",
  });
  window.location.reload();
}

function renderEmergencyBootFallback(detail: string): void {
  const root = document.getElementById("root");
  if (!root) return;
  root.innerHTML = `
    <div style="font-family:system-ui,sans-serif;padding:24px;max-width:560px;margin:0 auto;line-height:1.5">
      <h1 style="font-size:22px;margin-bottom:12px">Bungee Connect recovery mode</h1>
      <p style="margin-bottom:12px;color:#444">We couldn't render the full app on this browser session. You can still open login/signup directly.</p>
      <p style="font-size:13px;color:#666;margin-bottom:16px">Technical detail: ${detail}</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <a href="/connect/#/signup" style="padding:8px 12px;border:1px solid #ccc;border-radius:6px;text-decoration:none;color:#111">Open Sign up</a>
        <a href="/connect/#/" style="padding:8px 12px;border:1px solid #ccc;border-radius:6px;text-decoration:none;color:#111">Open Home</a>
      </div>
    </div>
  `;
}

function installBootWatchdog(): void {
  if (typeof window === "undefined") return;
  window.setTimeout(() => {
    const root = document.getElementById("root");
    if (!root) return;
    const hasVisibleContent = root.textContent?.trim().length || root.childElementCount > 0;
    if (hasVisibleContent) return;
    if (safeStorageGet(BOOT_WATCHDOG_KEY, "session") === "1") return;
    safeStorageSet(BOOT_WATCHDOG_KEY, "1", "session");
    const detail = "blank-root-after-boot-timeout";
    reportClientError({
      category: "recovery",
      code: "boot-watchdog",
      message: "Root remained blank after boot timeout",
      detail,
    });
    renderEmergencyBootFallback(detail);
  }, 3000);
}

if (typeof window !== "undefined") {
  installBootWatchdog();
  window.addEventListener("error", (event) => {
    const err = event.error ?? event.message;
    if (isMaxStackError(err)) {
      console.error("[bungee-connect] Max call stack detected", err);
      reportClientError({
        category: "window-error",
        code: "max-call-stack",
        message: getErrorMessage(err) || "Maximum call stack size exceeded",
        stack: event.error instanceof Error ? event.error.stack : undefined,
      });
      return;
    }
    reportClientError({
      category: "window-error",
      message: getErrorMessage(err) || "window error",
      stack: event.error instanceof Error ? event.error.stack : undefined,
    });
    reloadOnceForChunkError(err);
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    if (isMaxStackError(reason)) {
      console.error("[bungee-connect] Max call stack rejection detected", reason);
      reportClientError({
        category: "unhandled-rejection",
        code: "max-call-stack",
        message: getErrorMessage(reason) || "Maximum call stack size exceeded",
        stack: reason instanceof Error ? reason.stack : undefined,
      });
      return;
    }
    reportClientError({
      category: "unhandled-rejection",
      message: getErrorMessage(reason) || "Unhandled rejection",
      stack: reason instanceof Error ? reason.stack : undefined,
    });
    reloadOnceForChunkError(reason);
  });
}

/** Catches render errors so users see a message instead of a blank screen. */
class RootErrorBoundary extends Component<{ children: ReactNode }, { err: Error | null }> {
  state: { err: Error | null } = { err: null };

  static getDerivedStateFromError(e: Error): { err: Error } {
    return { err: e };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[bungee-connect] Root error:", error, info.componentStack);
    reportClientError({
      category: "react-boundary",
      message: error.message || "React boundary error",
      stack: `${error.stack || ""}\n${info.componentStack || ""}`.trim(),
    });
  }

  render(): ReactNode {
    if (this.state.err) {
      return (
        <div
          style={{
            fontFamily: "system-ui, sans-serif",
            padding: "2rem",
            maxWidth: "36rem",
            margin: "0 auto",
            lineHeight: 1.5,
          }}
        >
          <h1 style={{ fontSize: "1.25rem", marginBottom: "0.75rem" }}>Bungee Connect couldn’t start</h1>
          <p style={{ color: "#444", marginBottom: "1rem" }}>
            This is often caused by a <strong>browser extension</strong> (look for errors mentioning{" "}
            <code>content.js</code>, <code>excalidraw</code>, or <code>ChunkLoadError</code> in the console) or by{" "}
            <strong>private / strict browsing</strong> blocking storage. Try a normal window, disable extensions for
            Incognito, or allow site data for <code>shipbungee.com</code>.
          </p>
          <p style={{ fontSize: "0.875rem", color: "#666", marginBottom: "1rem" }}>
            Technical detail: {this.state.err.message}
          </p>
          <button
            type="button"
            style={{
              padding: "0.5rem 1rem",
              fontSize: "1rem",
              cursor: "pointer",
              borderRadius: "6px",
              border: "1px solid #ccc",
              background: "#f5f5f5",
            }}
            onClick={() => window.location.reload()}
          >
            Reload page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <RootErrorBoundary>
    <App />
  </RootErrorBoundary>,
);
