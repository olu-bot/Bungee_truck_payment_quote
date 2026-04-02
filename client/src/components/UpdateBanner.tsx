import { RefreshCw, X } from "lucide-react";
import { useState } from "react";

interface UpdateBannerProps {
  version: string;
}

export function UpdateBanner({ version }: UpdateBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] flex items-center justify-between gap-3 bg-amber-500 px-4 py-2 text-sm font-medium text-white shadow-md">
      <span className="flex items-center gap-2">
        <RefreshCw className="w-3.5 h-3.5 shrink-0" />
        Version <strong>{version}</strong> is available
      </span>
      <span className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded bg-white/20 px-3 py-0.5 text-xs font-semibold hover:bg-white/30 transition-colors"
        >
          Refresh to update
        </button>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => setDismissed(true)}
          className="rounded p-0.5 hover:bg-white/20 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </span>
    </div>
  );
}
