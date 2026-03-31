type StorageKind = "local" | "session";

const memoryFallback: Record<StorageKind, Map<string, string>> = {
  local: new Map<string, string>(),
  session: new Map<string, string>(),
};
const fallbackLogged = new Set<StorageKind>();

function logStorageFallback(kind: StorageKind, reason: unknown): void {
  if (fallbackLogged.has(kind)) return;
  fallbackLogged.add(kind);
  console.warn(`[recovery] ${kind}Storage unavailable; using in-memory fallback`, reason);
}

function getBrowserStorage(kind: StorageKind): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export function isStorageAvailable(kind: StorageKind = "local"): boolean {
  const store = getBrowserStorage(kind);
  if (!store) return false;
  try {
    const probeKey = `__bungee_storage_probe_${kind}__`;
    store.setItem(probeKey, "1");
    store.removeItem(probeKey);
    return true;
  } catch {
    logStorageFallback(kind, "probe_failed");
    return false;
  }
}

export function safeStorageGet(key: string, kind: StorageKind = "local"): string | null {
  const store = getBrowserStorage(kind);
  if (store) {
    try {
      return store.getItem(key);
    } catch {
      logStorageFallback(kind, "get_failed");
      // Fall through to in-memory value.
    }
  }
  return memoryFallback[kind].get(key) ?? null;
}

export function safeStorageSet(key: string, value: string, kind: StorageKind = "local"): void {
  const store = getBrowserStorage(kind);
  if (store) {
    try {
      store.setItem(key, value);
      memoryFallback[kind].set(key, value);
      return;
    } catch {
      logStorageFallback(kind, "set_failed");
      // Fall back to memory.
    }
  }
  memoryFallback[kind].set(key, value);
}

export function safeStorageRemove(key: string, kind: StorageKind = "local"): void {
  const store = getBrowserStorage(kind);
  if (store) {
    try {
      store.removeItem(key);
    } catch {
      logStorageFallback(kind, "remove_failed");
      // Ignore and clear fallback copy.
    }
  }
  memoryFallback[kind].delete(key);
}
