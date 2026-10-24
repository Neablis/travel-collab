// KI-2026-10-05-j: the paid eval's trip had one member, so a day split over
// the travellers and one over the members were the same number and
// `q-split-travellers` could not fail. Seeded as `live.eval.ts` seeds it, with
// no model: the case is only worth running if the two splits differ.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { japanTripCommands } from "@tc/fixtures";
import { executeTripCommand, executeTripCommandBatch } from "@/server/commands";
import { getTripDetail } from "@/server/projections";
import { db } from "@/server/db/client";
import { effectiveMembers } from "@/server/access/members";
import { expectationFor } from "./cases";
import { addNonTraveller, NON_TRAVELLER_ID } from "./seedMembers";
import { planningStart } from "./trips";

const OWNER = `seed-members-${randomUUID().slice(0, 8)}`;

describe("the live eval's trip", () => {
  it("has a member who is not travelling, so splitting over travellers and over members differ", async () => {
    const tripId = randomUUID();
    const created = await executeTripCommand({ type: "CreateTrip", tripId, name: "Japan (eval)" }, OWNER);
    expect(created.ok).toBe(true);
    const seeded = await executeTripCommandBatch(japanTripCommands(tripId, { startDate: planningStart(Date.now()) }), OWNER);
    if (!seeded.ok) throw new Error(seeded.error.message);

    const detail = await addNonTraveller(tripId, OWNER, seeded.detail);
    // As every read sees the trip, not only as the seeder returned it.
    const stored = await getTripDetail(tripId);
    expect(await effectiveMembers(db, tripId, stored!.members)).toEqual(detail.members);
    expect(detail.members.map(({ userId, travelling }) => ({ userId, travelling }))).toEqual([
      { userId: OWNER, travelling: true },
      { userId: NON_TRAVELLER_ID, travelling: false },
    ]);

    const subtotal = detail.days[0]!.costSubtotal;
    const split = expectationFor("q-split-travellers", detail)!.namesOneOfAmounts!;
    expect(split).toEqual([subtotal]);
    expect(split).not.toContain(subtotal / detail.members.length);
  });
});
