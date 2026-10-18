import type { PageSummary } from "@tc/contracts";
import { isOverviewPage } from "@tc/pages";

// Which notebook the Overview tab reads, in one place for its two readers: the
// lens (`OverviewLens`), and the trip page's server read (`tripFirstData`),
// which sends that notebook with the page. Written twice, the server could send
// one notebook while the lens went looking for another.

/** The notebook the Overview tab shows, or why there is none to show. */
export type OverviewPick<T extends PageSummary> = { ok: true; page: T } | { ok: false; message: string };

/**
 * The Overview notebook out of a trip's notebook list — or, for `?page=`, the
 * linked one (`linkedPageId`). A miss is a message the lens prints as it is.
 */
export function pickOverviewPage<T extends PageSummary>(
  pages: readonly T[],
  linkedPageId: string | null,
): OverviewPick<T> {
  const page = pages.find((p) => (linkedPageId === null ? isOverviewPage(p.context) : p.id === linkedPageId));
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
