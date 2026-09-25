// Handoff `current/…dc.html:630-668` "legend": a floating pill. The handoff
// puts it bottom-right; it sits TOP-right instead, because MapLibre puts its
// own attribution control in that bottom-right corner and the two overlapped
// (Mitchell, preview comment on `/demo?lens=Map`). Top-right is otherwise
// empty — `MapLens` adds no NavigationControl, the rail is pinned left
// (`MAP_RAIL_INSET_PX`), and the focus card is bottom-left of centre.
// The two stroke keys are the map's two route layers (M24 link 3): solid and
// dashed, split by `routeLegs` and `legVariant` in mapRailData.ts. A transit
// stop's own leg is solid when its `mode` is walk or bike and dashed for the
// other five — Mitchell, 2026-09-25: two styles, not seven. They sat behind a
// `map-legend-modes` Preview until a stop could say how it travels. The labels
// name the modes, which is the half of each layer a reader can act on; the
// other half is inference — a hop between two ordinary stops is solid, and a
// transit stop with no destination or no mode draws dashed, since it is
// travel by means nobody said. The dashed key is `dotted` because the design's
// is, and the map's 2 : 1.6 dash reads as dotted at 3px (MapLens's
// TRAVEL_DASHARRAY).
export function MapLegend() {
  return (
    <div
      className="absolute flex items-center gap-3.5 rounded-full border border-hairline bg-surface px-3.5 py-1.5 text-slate"
      // eslint-disable-next-line no-restricted-syntax -- computed position/z-index (18px right/top, z 45) and 11px legend text have no token equivalent, matching AssistantRail's computed-geometry pattern
      style={{ right: "18px", top: "18px", zIndex: 45, fontSize: "11px" }}
    >
      <span className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="bg-slate"
          // eslint-disable-next-line no-restricted-syntax -- 16x3px legend key stroke has no token equivalent
          style={{ width: "16px", height: "3px" }}
        />
        On foot or by bike
      </span>
      <span className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="border-t border-dotted border-slate"
          // eslint-disable-next-line no-restricted-syntax -- 16px-wide, 3px dotted legend key stroke has no token equivalent
          style={{ width: "16px", borderTopWidth: "3px" }}
        />
        By vehicle
      </span>
      <span className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="bg-slate"
          // eslint-disable-next-line no-restricted-syntax -- 16x3px legend key stroke at 0.55 opacity has no token equivalent
          style={{ width: "16px", height: "3px", opacity: 0.55 }}
        />
        Rest of trip
      </span>
      {/* The disc, and what its SHAPE claims. A teardrop's tip names one spot;
          a stop whose coordinate is only known to the city (`precision: "city"`,
          contracts/src/activity.ts) has no such spot, so MapLens draws those as
          one disc per centroid — carrying the count of stops under it when there
          is more than one. The wording says what the coordinate DESCRIBES rather
          than grading it: a city centroid is a precise coordinate for a city,
          not a bad one for a venue. Slate, like the stroke keys above, because a
          real disc carries its day's accent and no one swatch can stand for
          five. */}
      <span className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="rounded-full border-2 border-slate bg-slate/20"
          // eslint-disable-next-line no-restricted-syntax -- 12px legend key disc has no token equivalent, matching the stroke keys above
          style={{ width: "12px", height: "12px" }}
        />
        Somewhere in this city
      </span>
    </div>
  );
}
