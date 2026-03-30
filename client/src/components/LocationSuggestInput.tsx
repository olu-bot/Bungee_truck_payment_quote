import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { fetchPlaceSuggestions } from "@/lib/geo";
import { Loader2, MapPin } from "lucide-react";

const DEBOUNCE_MS = 280;

type LocationSuggestInputProps = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  "data-testid"?: string;
  disabled?: boolean;
  /** Shown inside the field on the left (e.g. MapPin). Overrides default pin. */
  leading?: ReactNode;
  /** When false, no left icon — tighter layout (e.g. route stops next to drag handle). */
  leadingIcon?: boolean;
  /** Debounce delay for API calls (default 280ms) */
  debounceMs?: number;
};

export function LocationSuggestInput({
  id: idProp,
  value,
  onChange,
  onBlur,
  placeholder,
  className,
  inputClassName,
  "data-testid": dataTestId,
  disabled,
  leading,
  leadingIcon = true,
  debounceMs = DEBOUNCE_MS,
}: LocationSuggestInputProps) {
  const reactId = useId();
  const listboxId = `${reactId}-listbox`;
  const id = idProp ?? `${reactId}-input`;

  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipFetchRef = useRef(false);

  const runSuggest = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const list = await fetchPlaceSuggestions(trimmed);
      setSuggestions(list);
      setHighlight(list.length > 0 ? 0 : -1);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (skipFetchRef.current) {
      skipFetchRef.current = false;
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void runSuggest(value);
    }, debounceMs);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value, debounceMs, runSuggest]);

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  function pick(s: string) {
    skipFetchRef.current = true;
    onChange(s);
    setSuggestions([]);
    setOpen(false);
    setHighlight(-1);
    // Notify walkthrough that a suggestion was picked
    const inputEl = wrapRef.current?.querySelector("input");
    if (inputEl) {
      inputEl.dispatchEvent(new CustomEvent("bungee:suggestion-picked", { bubbles: true }));
    }
    requestAnimationFrame(() => onBlur?.());
  }

  return (
    <div ref={wrapRef} className={cn("relative", className)}>
      <div className="relative">
        {leading != null ? (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none z-[1]">
            {leading}
          </span>
        ) : leadingIcon ? (
          <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none z-[1]" />
        ) : null}
        <Input
          id={id}
          role="combobox"
          aria-expanded={open && suggestions.length > 0}
          aria-controls={listboxId}
          aria-autocomplete="list"
          data-testid={dataTestId}
          disabled={disabled}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder={placeholder}
          className={cn(leading != null || leadingIcon ? "pl-9" : "pl-3", inputClassName)}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            setOpen(true);
            if (value.trim().length >= 2 && suggestions.length === 0) void runSuggest(value);
          }}
          onBlur={(e) => {
            // Defer so click on option fires first
            window.setTimeout(() => {
              if (!wrapRef.current?.contains(document.activeElement)) {
                setOpen(false);
                onBlur?.();
              }
            }, 0);
            // If relatedTarget is inside listbox, don't call onBlur for parent yet
            const rt = e.relatedTarget as Node | null;
            if (rt && wrapRef.current?.contains(rt)) return;
          }}
          onKeyDown={(e) => {
            if (!open || suggestions.length === 0) {
              if (e.key === "ArrowDown" && value.trim().length >= 2) {
                setOpen(true);
                void runSuggest(value);
              }
              return;
            }
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlight((h) => Math.max(h - 1, 0));
            } else if (e.key === "Enter" && highlight >= 0 && suggestions[highlight]) {
              e.preventDefault();
              pick(suggestions[highlight]!);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground pointer-events-none" />
        )}
      </div>

      {open && suggestions.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          className={cn(
            "absolute z-[100] mt-1 max-h-52 w-full overflow-auto rounded-md border border-border bg-popover",
            "shadow-lg py-1 text-sm",
            "ring-1 ring-black/5 dark:ring-white/10",
          )}
        >
          {suggestions.map((s, i) => (
            <li key={`${s}-${i}`} role="option" aria-selected={i === highlight}>
              <button
                type="button"
                tabIndex={-1}
                className={cn(
                  "flex w-full items-start gap-2 px-3 py-2 text-left text-foreground transition-colors",
                  "hover:bg-accent hover:text-accent-foreground",
                  i === highlight && "bg-accent text-accent-foreground",
                )}
                onMouseDown={(ev) => {
                  ev.preventDefault();
                  pick(s);
                }}
              >
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="leading-snug break-words">{s}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
