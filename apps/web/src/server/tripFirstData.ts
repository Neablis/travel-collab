import { randomUUID } from "node:crypto";
import { requireTripAccess } from "@/server/access/trip-access";
import { accessRevForRead } from "@/server/access/members";
import {
  tripAccessView,
  tripCoverView,
  tripDetailView,
  tripGlobalsView,
  tripHistoryView,
  tripPagesView,
  tripPageView,
} from "@/server/tripViews";
import { isDemoTripId } from "@/lib/demoTrip";
import { pickOverviewPage } from "@/lib/overviewPage";
import type { TripFirstData } from "@/lib/tripFirstData";

/**
 * **The trip page's first reads, answered on the server** (`docs/candidates.md`,
 * "The trip page renders its first data on the server"): every body the board
 * would otherwise fetch after hydration before it could draw — the trip, its
 * history, who is on it, the cover, the notebook list, the Overview notebook
 * and the globals — so the board is in the page's first HTML.
 *
 * One access check, `requireTripAccess` as the routes ask it, and every body
 * from the routes' own builders (`tripViews.ts`), so the page cannot answer
 * what the routes would refuse or send a shape they would not.
 *
 * `null` for anything but a full answer: a reader the routes would refuse
 * (signed out, a stranger, no such trip), the demo trip (its board has its own
 * path, ADR-031), and any read that fails, which is logged. The board then
 * reads everything itself, as it did before this existed.
 */
export async function tripFirstData(tripId: string): Promise<TripFirstData | null> {
  if (isDemoTripId(tripId)) return null;
  try {
    // Before the access check, for the access route's reason: a rev read first
    // is never newer than the member list served with it.
    const accessRev = await accessRevForRead(tripId);
    const access = await requireTripAccess(tripId, "viewer", { allowDemo: true });
    if ("error" in access) return null;
    const pagesRead = tripPagesView(tripId, access);
    // The Overview notebook is the one the lens would pick out of that list.
    const overviewRead = pagesRead.then((list) => {
      const pick = pickOverviewPage(list.pages, null);
      return pick.ok ? tripPageView(tripId, pick.page.id) : null;
    });
    const [history, accessView, cover, pages, overview, globals] = await Promise.all([
      tripHistoryView(tripId),
      tripAccessView(tripId, access, accessRev),
      tripCoverView(tripId),
      pagesRead,
      overviewRead,
      // Not the demo, so the reader `requireTripAccess` resolved is the session's.
      tripGlobalsView(access, access.userId),
    ]);
    if (history === null) return null;
    const first: TripFirstData = {
      served: randomUUID(),
      trip: tripDetailView(access),
      history,
      access: accessView,
      cover,
      pages,
      overview,
      globals,
    };
    // Through JSON, as a response body is, so the page holds exactly what a
    // fetch would have received: no `undefined` keys, no class instances.
    return JSON.parse(JSON.stringify(first)) as TripFirstData;
  } catch (error) {
    console.error("trip page: first data read failed; the board reads it itself", { tripId, error });
    return null;
  }
}
