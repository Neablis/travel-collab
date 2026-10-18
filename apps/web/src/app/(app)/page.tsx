import * as Sentry from "@sentry/nextjs";
import { ListedTripSummary } from "@tc/contracts";
import { HomeScreen } from "@/components/home/HomeScreen";
import { auth } from "@/server/auth";
import { listedTripsFor } from "@/server/listedTrips";

/**
 * Home (`/`), with the reader's trip list read on the server so the next-trip
 * hero and the grid are in the first HTML rather than drawn as skeletons until
 * a client fetch of `/api/trips` returns. It reads `listedTripsFor`, the route's
 * own body, in-process (this file's lint-wall exemption, 2026-10-18); the
 * screen itself is `HomeScreen`.
 *
 * `initialTrips` is `null` when there is no session (the proxy normally sends
 * a signed-out `/` to the landing first) or the read threw, and the screen then
 * reads the list itself exactly as it did before. `initialToday` is the
 * server's UTC date, so the hero this HTML picks is the one hydration picks.
 */
export default async function Home() {
  return <HomeScreen initialTrips={await servedTrips()} initialToday={new Date().toISOString().slice(0, 10)} />;
}

/**
 * The reader's list as `fetchTrips()` would hand it to the screen: parsed
 * through the contract, so nothing the client would not have received crosses
 * the boundary. `null` for no session, and for a read that failed — reported,
 * because the client's fallback alone would hide it.
 */
async function servedTrips(): Promise<ListedTripSummary[] | null> {
  try {
    const userId = (await auth())?.user?.id;
    if (!userId) return null;
    // Through JSON first, as the route's response is, so the parse sees the
    // value the client's `fetchTrips()` would have parsed.
    const wire = JSON.parse(JSON.stringify(await listedTripsFor(userId))) as unknown[];
    return wire.map((t) => ListedTripSummary.parse(t));
  } catch (error) {
    Sentry.captureException(error);
    return null;
  }
}
