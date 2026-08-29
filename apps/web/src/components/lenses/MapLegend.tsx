import { Preview } from "@/components/ui/preview";

// Handoff `current/…dc.html:630-668` "legend": a floating pill. The handoff
// puts it bottom-right; it sits TOP-right instead, because MapLibre puts its
// own attribution control in that bottom-right corner and the two overlapped
// (Mitchell, preview comment on `/demo?lens=Map`). Top-right is otherwise
// empty — `MapLens` adds no NavigationControl, the rail is pinned left
// (`MAP_RAIL_INSET_PX`), and the focus card is bottom-left of centre.
// We model no transport mode (no field distinguishes "on foot" from "by
// train or taxi" for a leg), so those two keys are a claim this app can't
// make yet — behind their own Preview, narrower than wrapping the whole
// legend. "Rest of trip" (real: every drawn route is solid, at full or
// reduced opacity depending on focus) stays outside it.
export function MapLegend() {
  return (
    <div
      className="absolute flex items-center gap-3.5 rounded-full border border-hairline bg-surface px-3.5 py-1.5 text-slate"
      // eslint-disable-next-line no-restricted-syntax -- computed position/z-index (18px right/top, z 45) and 11px legend text have no token equivalent, matching AssistantRail's computed-geometry pattern
      style={{ right: "18px", top: "18px", zIndex: 45, fontSize: "11px" }}
    >
      <Preview id="map-legend-modes" size="compact">
        <div className="flex items-center gap-3.5">
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="bg-slate"
              // eslint-disable-next-line no-restricted-syntax -- 16x3px legend key stroke has no token equivalent
              style={{ width: "16px", height: "3px" }}
            />
            On foot
          </span>
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="border-t border-dotted border-slate"
              // eslint-disable-next-line no-restricted-syntax -- 16px-wide, 3px dotted legend key stroke has no token equivalent
              style={{ width: "16px", borderTopWidth: "3px" }}
            />
            By train or taxi
          </span>
        </div>
      </Preview>
      <span className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="bg-slate"
          // eslint-disable-next-line no-restricted-syntax -- 16x3px legend key stroke at 0.55 opacity has no token equivalent
          style={{ width: "16px", height: "3px", opacity: 0.55 }}
        />
        Rest of trip
      </span>
    </div>
  );
}
