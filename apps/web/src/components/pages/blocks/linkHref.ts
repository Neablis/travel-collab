import type { LinkTarget } from "@tc/pages";

/**
 * Where an internal link card goes (ADR-056) — the one place a stored
 * `LinkTarget` meets the app's routes, so a route that moves is one edit here
 * and no stored page.
 *
 * A notebook is its own route. A tab or a day is a view of the board, and
 * **from the board it stays on the board's own path** — `/trips/:id`, but also
 * `/demo` and an invite's look, which mount the same board under a different
 * address and would lose their visitor's access if sent to `/trips/:id`. From a
 * notebook route it goes to the trip.
 */
export function linkHref(to: LinkTarget, tripId: string, pathname: string): string {
  if (to.kind === "notebook") return `/trips/${tripId}/pages/${to.pageId}`;
  const base = pathname.includes("/pages") ? `/trips/${tripId}` : pathname;
  if (to.kind === "view") return `${base}?view=${to.view}`;
  // The resolver hands every day target over by id; an index form never
  // reaches here, and if it did, Plan without a focused day is still true.
  return to.day.kind === "dayId" ? `${base}?view=Plan&day=${to.day.dayId}` : `${base}?view=Plan`;
}
