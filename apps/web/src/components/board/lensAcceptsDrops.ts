import type { View } from "@/components/trip/context/LensRouter";

/**
 * Whether this view has anywhere to drop a stop onto.
 *
 * This is the gate for the Unscheduled drawer, and it is written as a question
 * about drop targets rather than as a list of views on purpose — that is the
 * rule it exists to serve (`RULES.md` 2, decided by Mitchell 2026-08-26):
 *
 * > If the drawer element has page interactions (almost always a drag/drop
 * > onto the page) then add it back.
 *
 * So when another view registers drop targets, this function is the only thing
 * that changes and the drawer returns to it by itself. Do not re-express it as
 * `view !== "Map"` or a view whitelist; the point is that the answer follows
 * the drop targets rather than being restated beside them and drifting.
 *
 * Today only Plan registers any: `dropTargetForElements` is wired for the
 * rack's own zone, `Column.tsx`'s day columns and each `ActivityCard`, all
 * inside the Plan view. Nothing under `lenses/` registers one.
 *
 * SPEC §24 renamed the view (Board -> Plan) and deleted Timeline; neither
 * changes the rule, and the four TODO.md rack gaps it used to name are now
 * three, Timeline's having gone with the lens.
 */
export function lensAcceptsDrops(view: View): boolean {
  return view === "Plan";
}
