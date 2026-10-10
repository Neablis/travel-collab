import type { TimeFormat } from "@tc/contracts";
import { useDistanceUnit, useTimeFormat } from "@/components/account/PreferencesProvider";
import { cn } from "@/lib/cn";
import { toClockLabel } from "@/lib/time";
import { kmLabel } from "@/lib/units";
import type { AccentFamily } from "@/lib/dayAccent";
import { MapLegList } from "./MapFocusCard";
import type { MapDay } from "./mapRailData";

// M26 link 5a. The design's own argument, and the one Mitchell restated:
// *"The day's detail is a hover card beside the rail, not a panel parked over
// the map: it costs no space until you ask a day a question."*
//
// **Detail on demand, NOT a second way to select a day.** That distinction is
// the whole reason `MapRail`'s no-hover-tint rule survives this link intact:
// the row does not change on hover, the card appears beside it, and moving the
// mouse out is how a reader gets the clean map back.

const DOT_BG: Record<AccentFamily, string> = {
  brand: "bg-brand",
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  neutral: "bg-slate",
};

/** Handoff geometry: 256px wide, at `left: 296px`, clamped into the map wrap. */
export const HOVER_CARD_WIDTH_PX = 256;
export const HOVER_CARD_LEFT_PX = 296;
/** The clamp the design specifies: `[16, wrapHeight - 168]`. */
export const HOVER_CARD_MIN_TOP_PX = 16;
export const HOVER_CARD_BOTTOM_INSET_PX = 168;

/**
 * Where the card sits, given the hovered row's top and the wrap's height.
 *
 * Exported and pure because the clamp is the part worth asserting: jsdom has no
 * layout, so a test can pin "top-aligned to the row, and never off either end"
 * here without pretending to measure anything.
 */
export function hoverCardTop(rowTop: number, wrapHeight: number): number {
  const lowest = Math.max(HOVER_CARD_MIN_TOP_PX, wrapHeight - HOVER_CARD_BOTTOM_INSET_PX);
  return Math.min(Math.max(rowTop, HOVER_CARD_MIN_TOP_PX), lowest);
}

/** How many places an "only day in" note names before it says "and N more". */
const ONLY_HERE_NAMED = 2;

/**
 * The day's one note: what sets it apart from the trip's other days.
 *
 * It used to be the longest hop ("Longest hop 3.1 km — A to B"), and Mitchell
 * asked for better: *"Show something truly unique about that day, or something
 * else that we won't need AI to pull off."* Which fact a day gets is
 * `dayHighlights`' decision (mapRailData.ts); this is only its wording, in the
 * reader's clock. Exported for its own test.
 */
export function hoverNote(day: MapDay, clock: TimeFormat): string {
  const highlight = day.highlight;
  if (day.isEmpty || highlight === null) return "No stops yet";
  switch (highlight.kind) {
    case "only-here": {
      const named = highlight.places.slice(0, ONLY_HERE_NAMED);
      const more = highlight.places.length - named.length;
      const list = more > 0 ? `${named.join(", ")} and ${more} more` : named.join(" and ");
      return `Only day in ${list}`;
    }
    case "most-stops":
      // Not "7 stops": the trimmed card must not read as the focus card's
      // stops line, which it exists not to repeat.
      return `Most stops of any day (${highlight.stops})`;
    case "earliest":
      return `Earliest start of the trip, ${toClockLabel(highlight.time, clock)}`;
    case "latest":
      return `Latest finish of the trip, ${toClockLabel(highlight.time, clock)}`;
    case "bookends":
      return `Starts at ${highlight.first}, ends at ${highlight.last}`;
    case "single":
      return `Just one stop: ${highlight.title}`;
  }
}

export function MapHoverCard({
  day,
  top,
  trimmed = false,
}: {
  day: MapDay;
  top: number;
  /**
   * **The focused day's card says only what its focus card does not** (M27,
   * Mitchell's preview comment "I can't seem to get the hover state on the
   * first element"). The focus card already shows the city and the
   * stops-and-distance line, so repeating them was why this card used to be
   * suppressed for the focused day entirely, and day 0 is focused by default.
   * Trimmed, it keeps the hover state and adds only `Day N` and the day's
   * note. For an empty day that note is "No stops yet", the same sentence the
   * focus card shows, so it is dropped too.
   */
  trimmed?: boolean;
}) {
  const unit = useDistanceUnit();
  const clock = useTimeFormat();
  const note = trimmed && day.isEmpty ? null : hoverNote(day, clock);
  const stat =
    trimmed || day.stops.length === 0
      ? null
      : `${day.stops.length} stop${day.stops.length === 1 ? "" : "s"}${
          day.totalKm !== null ? ` · ${kmLabel(day.totalKm, unit)}` : ""
        }`;

  return (
    <div
      data-testid="map-hover-card"
      aria-hidden
      className={cn(
        "map-hover-card absolute flex flex-col gap-1.5 rounded-xl border border-hairline bg-surface p-3.5 shadow-overlay",
      )}
      // **`pointer-events: none` is not decoration.** The card overlaps the map
      // and, at the bottom of the rail, the rail itself — without this it would
      // eat the click that selects a day, and hovering toward it from a row
      // would fire that row's `mouseleave` and tear the card down under the
      // cursor. It is `aria-hidden` for the same reason: nothing here is
      // reachable or actionable, and the rail row it describes is already in
      // the accessibility tree with the same facts.
      // eslint-disable-next-line no-restricted-syntax -- computed geometry (256px wide at left 296px, measured top, z 3), the same pattern MapFocusCard and AssistantRail use
      style={{
        left: `${HOVER_CARD_LEFT_PX}px`,
        top: `${top}px`,
        width: `${HOVER_CARD_WIDTH_PX}px`,
        zIndex: 3,
        pointerEvents: "none",
      }}
    >
      <div className="flex items-center gap-1.5">
        <span aria-hidden className={cn("size-2.5 shrink-0 rounded-full", DOT_BG[day.accent])} />
        {/* **Both**, where the focus card shows `city ?? label`. The design's
            line is `Day N · City`: the rail is scrolled and a reader hovering
            one row among many wants to know WHICH day, not only where. */}
        <span className="text-sm font-bold text-ink">
          {day.label}
          {!trimmed && day.city !== null && ` · ${day.city}`}
        </span>
      </div>
      {stat !== null && <div className="font-mono text-xs text-slate">{stat}</div>}
      {/* Trimmed drops them for the reason it drops the stat: the focused
          day's card beside it already lists them. */}
      {!trimmed && <MapLegList legs={day.legs} />}
      {note !== null && (
        <p
          className="text-slate"
          // eslint-disable-next-line no-restricted-syntax -- 12.5px note has no token equivalent (between text-xs/12px and text-sm/13px), matching MapFocusCard
          style={{ fontSize: "12.5px" }}
        >
          {note}
        </p>
      )}
    </div>
  );
}
