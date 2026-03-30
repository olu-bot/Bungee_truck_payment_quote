import { Component, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

/** Catches render errors so users see a message instead of a blank screen. */
class RootErrorBoundary extends Component<{ children: ReactNode }, { err: Error | null }> {
  state: { err: Error | null } = { err: null };

  static getDerivedStateFromError(e: Error): { err: Error } {
    return { err: e };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[bungee-connect] Root error:", error, info.componentStack);
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
