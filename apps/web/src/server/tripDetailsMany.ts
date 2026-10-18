import { inArray } from "drizzle-orm";
import { TripDetail } from "@tc/contracts";
import { db } from "./db/client";
import { tripDetails } from "./db/schema";
import { isUuid } from "./ids";

// `getTripDetail` for many trips in one statement, for a caller that would
// otherwise read them one at a time — the assistant's account trips were one
// select per trip a person may open (Sentry's N+1). Its own module rather than
// a second export of `projections.ts`, which another workstream owns.
//
// **The same answer per trip as `getTripDetail`**: an id that is not a uuid or
// has no row is absent, and a stored doc that fails `TripDetail` is logged and
// THROWN, never skipped — a skipped trip would vanish from what the assistant
// sees with nothing to say why.

/** The trips among `tripIds` that exist, by id, each parsed exactly as `getTripDetail` parses it. */
export async function getTripDetails(tripIds: readonly string[]): Promise<Map<string, TripDetail>> {
  const ids = [...new Set(tripIds.filter(isUuid))];
  if (ids.length === 0) return new Map();
  const rows = await db.select().from(tripDetails).where(inArray(tripDetails.tripId, ids));
  const found = new Map<string, TripDetail>();
  for (const { tripId, doc } of rows) {
    const parsed = TripDetail.safeParse(doc);
    if (!parsed.success) {
      console.error("trip_details doc failed TripDetail parse", { tripId, issues: parsed.error.issues });
      throw parsed.error;
    }
    found.set(tripId, parsed.data);
  }
  return found;
}
