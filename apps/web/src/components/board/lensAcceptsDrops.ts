import type { Lens } from "@/components/trip/context/LensRouter";

/**
 * Whether this lens has anywhere to drop a stop onto.
 *
 * This is the gate for the Unscheduled drawer, and it is written as a question
 * about drop targets rather than as a list of lenses on purpose — that is the
 * rule it exists to serve (`RULES.md` 2, decided by Mitchell 2026-08-26):
 *
 * > If the drawer element has page interactions (almost always a drag/drop
 * > onto the page) then add it back.
 *
 * So when Timeline and Calendar register drop targets — designs for dropping
 * onto a timeline and a calendar exist, and `TODO.md`'s "Unscheduled rack:
 * drag support is Board-view-only" entry lists the four gaps — this function is
 * the only thing that changes, and the drawer returns to those lenses by
 * itself. Do not re-express it as `lens !== "Map"` or a lens whitelist; the
 * point is that the answer follows the drop targets rather than being restated
 * beside them and drifting.
 *
 * Today only Board registers any: `dropTargetForElements` is wired for the
 * rack's own zone, `Column.tsx`'s day columns and each `ActivityCard`, all
 * inside the Board lens. Nothing under `lenses/` registers one.
 */
export function lensAcceptsDrops(lens: Lens): boolean {
  return lens === "Board";
}
