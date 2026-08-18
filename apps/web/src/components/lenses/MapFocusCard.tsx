import { cn } from "@/lib/cn";
import type { AccentFamily } from "@/lib/dayAccent";
import type { MapDay } from "./mapRailData";

const DOT_BG: Record<AccentFamily, string> = {
  brand: "bg-brand",
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
};

// Handoff `current/…dc.html:630-668` "focus card": floats over the map,
// explaining whichever day the rail currently has focused — including an
// empty day, where the camera deliberately doesn't move (Task 2.3) and this
// card is the only feedback the click did anything.
export function MapFocusCard({ day }: { day: MapDay | null }) {
  if (day === null) return null;

  const stat =
    day.stops.length === 0
      ? null
      : `${day.stops.length} stop${day.stops.length === 1 ? "" : "s"}${day.totalKm !== null ? ` · ${day.totalKm.toFixed(1)} km` : ""}`;

  return (
    <div
      className="absolute flex flex-col gap-1.5 rounded-xl border border-hairline bg-surface p-3.5 shadow-overlay"
      // eslint-disable-next-line no-restricted-syntax -- computed position/width/z-index (300px left, 18px bottom, 256px wide, z 3) has no token equivalent, matching AssistantRail's computed-geometry pattern
      style={{ left: "300px", bottom: "18px", width: "256px", zIndex: 3 }}
    >
      <div className="flex items-center gap-1.5">
        <span aria-hidden className={cn("size-2.5 shrink-0 rounded-full", DOT_BG[day.accent])} />
        <span className="text-sm font-bold text-ink">{day.city ?? day.label}</span>
      </div>
      {stat !== null && <div className="font-mono text-xs text-slate">{stat}</div>}
      {day.flagText !== null && (
        <p
          className="text-slate"
          // eslint-disable-next-line no-restricted-syntax -- 12.5px note has no token equivalent (between text-xs/12px and text-sm/13px)
          style={{ fontSize: "12.5px" }}
        >
          {day.flagText}
        </p>
      )}
    </div>
  );
}
