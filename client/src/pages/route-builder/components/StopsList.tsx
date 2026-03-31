import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { GripVertical, Trash2, Plus, Route, Loader2 } from "lucide-react";
import { LocationSuggestInput } from "@/components/LocationSuggestInput";
import type { FormStop } from "../hooks/useRouteStops";

type StopsListProps = {
  formStops: FormStop[];
  dragIdx: number | null;
  dragOverIdx: number | null;
  isGeocodingRoute: boolean;
  isCalculating: boolean;
  onDragStart: (idx: number, e: React.DragEvent) => void;
  onDragOver: (idx: number, e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (idx: number, e: React.DragEvent) => void;
  onDragEnd: () => void;
  onUpdateLocation: (idx: number, location: string) => void;
  onRemoveStop: (idx: number) => void;
  onAddStop: () => void;
  onBlurStop: () => void;
  onBuildRoute: () => void;
};

export function StopsList({
  formStops,
  dragIdx,
  dragOverIdx,
  isGeocodingRoute,
  isCalculating,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  onUpdateLocation,
  onRemoveStop,
  onAddStop,
  onBlurStop,
  onBuildRoute,
}: StopsListProps) {
  return (
    <>
      {formStops.map((stop, idx) => {
        const isFirst = idx === 0;
        const isLast = idx === formStops.length - 1;
        const stopLabel = isFirst
          ? "Origin"
          : isLast
            ? "Destination"
            : `Stop ${idx}`;
        const isDragging = dragIdx === idx;
        const isDragOver = dragOverIdx === idx;

        return (
          <div
            key={stop.id}
            className={`space-y-1 rounded-md transition-all ${
              isDragging ? "opacity-40" : ""
            } ${isDragOver ? "ring-2 ring-primary/50 bg-primary/5" : ""}`}
            draggable
            onDragStart={(e) => onDragStart(idx, e)}
            onDragOver={(e) => onDragOver(idx, e)}
            onDragLeave={onDragLeave}
            onDrop={(e) => onDrop(idx, e)}
            onDragEnd={onDragEnd}
          >
            <Label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              {stopLabel}
            </Label>
            <div className="flex items-center gap-1.5">
              {/* Drag handle */}
              <div
                className="shrink-0 cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground p-0.5"
                data-testid={`drag-handle-${idx}`}
              >
                <GripVertical className="w-4 h-4" />
              </div>

              {/* Location input */}
              <div className="flex-1 min-w-0">
                <LocationSuggestInput
                  data-testid={`input-stop-${idx}`}
                  leadingIcon={false}
                  inputClassName="text-sm h-9"
                  placeholder={
                    isFirst
                      ? "e.g. Mississauga"
                      : isLast
                        ? "e.g. Scarborough"
                        : "Location"
                  }
                  value={stop.location}
                  onChange={(v) => onUpdateLocation(idx, v)}
                  onBlur={onBlurStop}
                />
              </div>

              {/* Remove button */}
              {!isFirst && !isLast && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 w-9 p-0 text-muted-foreground hover:text-destructive shrink-0"
                  data-testid={`button-remove-stop-${idx}`}
                  onClick={() => onRemoveStop(idx)}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
          </div>
        );
      })}

      {/* Add Stop */}
      <Button
        variant="outline"
        size="sm"
        className="w-full text-xs"
        data-testid="button-add-stop"
        onClick={onAddStop}
      >
        <Plus className="w-3.5 h-3.5 mr-1" />
        Add Stop
      </Button>

      {/* Manual Build button */}
      {formStops.filter((s) => s.location.trim()).length >= 2 && (
        <Button
          className="w-full bg-orange-400 hover:bg-orange-500 text-white"
          data-testid="button-build-route"
          disabled={isGeocodingRoute || isCalculating}
          onClick={onBuildRoute}
        >
          {isGeocodingRoute || isCalculating ? (
            <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
          ) : (
            <Route className="w-4 h-4 mr-1.5" />
          )}
          Build Route
        </Button>
      )}
    </>
  );
}
