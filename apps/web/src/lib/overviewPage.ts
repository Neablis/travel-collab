import type { PageSummary } from "@tc/contracts";
import { TODAY_SEED_KEY, isOverviewPage, type TripPhase } from "@tc/pages";

// Which notebook the Overview tab reads, in one place for its two readers: the
// lens (`OverviewLens`), and the trip page's server read (`tripFirstData`),
// which sends that notebook with the page. Written twice, the server could send
// one notebook while the lens went looking for another.

/** The notebook the Overview tab shows, or why there is none to show. */
export type OverviewPick<T extends PageSummary> = { ok: true; page: T } | { ok: false; message: string };

/** Whether the Overview tab shows Today in this phase: from *soon* through the end date (M52 decision 11). */
export function overviewShowsToday(phase: TripPhase | null): boolean {
  return phase === "soon" || phase === "underway";
}

/**
 * The Overview notebook out of a trip's notebook list — or, for `?page=`, the
 * linked one (`linkedPageId`). A miss is a message the lens prints as it is.
 *
 * From three days before the trip through its last day the tab swaps to
 * Today (`phase`, `tripNow`'s), and to the Overview again on a trip without
 * one. `null` while the phase is not known.
 */
export function pickOverviewPage<T extends PageSummary>(
  pages: readonly T[],
  linkedPageId: string | null,
  phase: TripPhase | null,
): OverviewPick<T> {
  const today = overviewShowsToday(phase) ? pages.find((p) => p.seedKey === TODAY_SEED_KEY) : undefined;
  const page = linkedPageId !== null ? pages.find((p) => p.id === linkedPageId) : (today ?? pages.find((p) => isOverviewPage(p.context)));
  if (page !== undefined) return { ok: true, page };
  // A linked notebook that has since been deleted, or a hand-edited URL.
  if (linkedPageId !== null) return { ok: false, message: "This notebook is not in this trip." };
  // A trip whose Overview is genuinely absent: every trip seeded since
  // 2026-09-12 has one, and a trip that was seeded BEFORE it has the two
  // older prose pages instead and will never be re-seeded (`listPages`
  // seeds only into a trip with zero pages). That is a real state and it
  // gets a real answer rather than a spinner that never resolves.
  return { ok: false, message: "This trip has no Overview page." };
}
