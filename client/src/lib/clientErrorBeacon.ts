type ClientErrorPayload = {
  category: "window-error" | "unhandled-rejection" | "react-boundary" | "recovery";
  message: string;
  stack?: string;
  code?: string;
  detail?: string;
  href: string;
  ua: string;
  ts: string;
};

const sentKeys = new Set<string>();

function buildKey(p: ClientErrorPayload): string {
  return `${p.category}|${p.code ?? ""}|${p.message.slice(0, 120)}`;
}

export function reportClientError(
  partial: Omit<ClientErrorPayload, "href" | "ua" | "ts">,
): void {
  if (typeof window === "undefined") return;
  const payload: ClientErrorPayload = {
    ...partial,
    href: window.location.href,
    ua: navigator.userAgent,
    ts: new Date().toISOString(),
  };
  const key = buildKey(payload);
  if (sentKeys.has(key)) return;
  sentKeys.add(key);

  const body = JSON.stringify(payload);
  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: "application/json" });
      navigator.sendBeacon("/api/client-error", blob);
      return;
    }
  } catch {
    // fallback to fetch below
  }
  fetch("/api/client-error", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {
    // swallow; telemetry should never affect user flow
  });
}
