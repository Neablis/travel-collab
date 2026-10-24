// **Who is on the live eval's trip besides the asker** (KI-2026-10-05-j).
//
// The paid lane seeds its trip with `CreateTrip` and the Japan commands, which
// leaves the eval actor its only member. With one member a day split over the
// travellers and one split over the members are the same number, so
// `q-split-travellers` passed whichever the assistant did. The demo roster has
// Kenji, a member who is not travelling (travellers spec D1); this gives the
// eval's trip one too, through the same writes the app makes: a membership
// granted, then the owner saying he is not travelling.
import type { TripDetail } from "@tc/contracts";
import { db } from "@/server/db/client";
import { effectiveMembers, grantMembership } from "@/server/access/members";
import { setTravelling } from "@/server/access/travellers";
import { upsertUser } from "@/server/users";

/** The member who stays home. A name, as the demo's ids are, so a turn that names him reads as a person. */
export const NON_TRAVELLER_ID = "eval-kenji";

/**
 * Adds `NON_TRAVELLER_ID` to the trip as an editor who is not travelling, and
 * returns `detail` with the members every read sees (`effectiveMembers`), so
 * an expectation computed from it is the trip the turn reads.
 */
export async function addNonTraveller(tripId: string, ownerId: string, detail: TripDetail): Promise<TripDetail> {
  await upsertUser({ id: NON_TRAVELLER_ID, email: null, name: "Kenji", image: null });
  const granted = await grantMembership(db, { tripId, userId: NON_TRAVELLER_ID, role: "editor", invitedBy: ownerId, now: new Date().toISOString() });
  if (!granted) throw new Error(`seed: ${NON_TRAVELLER_ID} was already on trip ${tripId}`);
  const set = await setTravelling(tripId, ownerId, NON_TRAVELLER_ID, false);
  if (!set.ok) throw new Error(`seed: ${set.error.message}`);
  return { ...detail, members: await effectiveMembers(db, tripId, detail.members) };
}
