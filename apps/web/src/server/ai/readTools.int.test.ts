import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { SavedDayVisibility } from "@tc/contracts";
import { executeTripCommand } from "@/server/commands";
import { getTripDetail } from "@/server/projections";
import { saveDay, setSavedDayVisibility } from "@/server/savedDays";
import { searchPlaybooks } from "@/server/ai/readTools";

// `search_playbooks` is the one read tool that reaches outside the trip, and
// the only one whose answer depends on WHO is asking (ADR-042 Decision 2). Its
// visibility set has to be exactly `readableSavedDay`'s — your own days plus
// anybody's published one — and the failure modes point in opposite directions:
// narrower and the model proposes days the apply door then 404s on; wider and
// the tool is a way to enumerate what people have kept private.
//
// This file lives in the integration lane because the claim is about a WHERE
// clause. A unit test over a stubbed query would assert the stub.
//
// Fresh identities per test (KI-69): the library is not truncated between runs,
// and every assertion below is "these rows and not those" over a shared table.
let AUTHOR = "";
let STRANGER = "";

beforeEach(() => {
  const run = randomUUID().slice(0, 8);
  AUTHOR = `playbook-author-${run}`;
  STRANGER = `playbook-stranger-${run}`;
});

/** One saved day belonging to `ownerId`, built from a real trip through `saveDay`. */
async function seedSavedDay(
  ownerId: string,
  name: string,
  city: string,
): Promise<string> {
  const tripId = randomUUID();
  const dayId = randomUUID();
  await executeTripCommand({ type: "CreateTrip", tripId, name: `${name} source` }, ownerId);
  await executeTripCommand({ type: "AddDay", tripId, dayId }, ownerId);
  await executeTripCommand(
    {
      type: "AddActivity",
      tripId,
      activityId: randomUUID(),
      dayId,
      title: "Fushimi Inari",
      location: { name: "Fushimi Inari", city },
      timeWindow: { start: "09:00", end: "11:00" },
    },
    ownerId,
  );
  await executeTripCommand(
    { type: "AddActivity", tripId, activityId: randomUUID(), dayId, title: "Nishiki Market" },
    ownerId,
  );
  const detail = (await getTripDetail(tripId))!;
  const saved = await saveDay({ name, dayId }, detail, ownerId);
  if (!saved.ok) throw new Error(`could not save the day: ${saved.error.message}`);
  return saved.value.savedDayId;
}

async function publish(savedDayId: string, ownerId: string): Promise<void> {
  const published = await setSavedDayVisibility(savedDayId, ownerId, SavedDayVisibility.enum.public);
  if (published === null) throw new Error("could not publish the day");
}

describe("search_playbooks", () => {
  it("returns a published day and the caller's own, and NEVER somebody else's private one", async () => {
    const city = `Kyoto-${randomUUID().slice(0, 8)}`;
    const published = await seedSavedDay(AUTHOR, "A published day", city);
    await publish(published, AUTHOR);
    const authorsPrivate = await seedSavedDay(AUTHOR, "The author's private day", city);
    const strangersOwn = await seedSavedDay(STRANGER, "The stranger's own private day", city);

    const found = await searchPlaybooks(STRANGER, { cities: [city] });
    const ids = found.days.map((day) => day.savedDayId);

    // Both halves of the rule, asserted as one set rather than two contains():
    // "your own plus anybody's published" is a set equality, and a test that
    // only checked membership would pass a query that returned the whole table.
    expect(ids.sort()).toEqual([published, strangersOwn].sort());
    // The negative, said out loud. This is the enumeration attack
    // `readableSavedDay`'s WHERE clause is written to defeat, reached from a
    // door it did not exist for when it was written.
    expect(ids).not.toContain(authorsPrivate);
  });

  it("carries what the model needs to choose, and the author's own day back to them", async () => {
    const city = `Osaka-${randomUUID().slice(0, 8)}`;
    const savedDayId = await seedSavedDay(AUTHOR, "Dotonbori after dark", city);
    await publish(savedDayId, AUTHOR);

    const asAuthor = await searchPlaybooks(AUTHOR, { cities: [city] });
    expect(asAuthor.searched).toBe(city);
    expect(asAuthor.days).toEqual([
      {
        savedDayId,
        name: "Dotonbori after dark",
        cities: [city],
        stopCount: 2,
        totalCost: null,
        adds: 0,
        mine: true,
      },
    ]);
    // `mine` is the reader's relationship to the row, not a property of it.
    const asStranger = await searchPlaybooks(STRANGER, { cities: [city] });
    expect(asStranger.days.map((day) => day.mine)).toEqual([false]);
  });

  it("honours `limit`, so one call cannot pull the whole library into a step", async () => {
    const city = `Nara-${randomUUID().slice(0, 8)}`;
    for (const name of ["First", "Second", "Third"]) {
      await publish(await seedSavedDay(AUTHOR, name, city), AUTHOR);
    }
    const found = await searchPlaybooks(STRANGER, { cities: [city], limit: 2 });
    expect(found.days).toHaveLength(2);
  });
});
