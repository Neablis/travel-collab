import type { ResolvedLinkTarget } from "@tc/pages";

/**
 * Where an internal link card goes (ADR-056) — the one place a stored
 * `LinkTarget` meets the app's routes, so a route that moves is one edit here
 * and no stored page.
 *
 * A tab or a day is a view of the board, and **from the board it stays on the
 * board's own path** — `/trips/:id`, but also `/demo` and an invite's look,
 * which mount the same board under a different address and would lose their
 * visitor's access if sent to `/trips/:id`. From a notebook route it goes to
 * the trip.
 *
 * A notebook is its own route — for a member. That route is behind sign-in, so
 * a board mounted anywhere else reads the notebook in its Overview tab instead
 * (`?page=`, `OverviewLens`): until 2026-09-27 the demo's "Also in this trip"
 * cards drew with no link at all, and Mitchell reported them dead.
 */
export function linkHref(to: ResolvedLinkTarget, tripId: string, pathname: string): string {
  // No pathname is a render outside the router, which only a test does.
  const offTrip = pathname !== "" && !pathname.startsWith("/trips/");
  if (to.kind === "notebook") {
    return offTrip ? `${pathname}?view=Overview&page=${to.pageId}` : `/trips/${tripId}/pages/${to.pageId}`;
  }
  const base = pathname.includes("/pages") ? `/trips/${tripId}` : pathname;
  if (to.kind === "view") return `${base}?view=${to.view}`;
  // The resolver hands every day target over by id; an index form never
  // reaches here, and if it did, Plan without a focused day is still true.
  return to.day.kind === "dayId" ? `${base}?view=Plan&day=${to.day.dayId}` : `${base}?view=Plan`;
}
