import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BatchableCommand, CreateSuggestionInput } from "@tc/contracts";
import { executeTripCommand, executeTripCommandBatch } from "../commands";
import { grantMembership } from "../access/members";
import { db } from "../db/client";
import { tripSuggestionChanges, tripSuggestions, users } from "../db/schema";
import { readStream } from "../eventStore";
import { entitleAccounts } from "../test-support/entitledAccount";
import { createSuggestion } from "./create";
import { listSuggestionChanges } from "./list";
import { resolveSuggestionChange } from "./resolve";
import { suggestionsRevFor } from "./rev";

// Fresh identities and a fresh trip per test (KI-69): every assertion is about
// rows keyed to this test's trip, so nothing here truncates a shared table.
let OWNER = "";
let SUGGESTER = "";
let OTHER_SUGGESTER = "";
let EDITOR = "";
let VIEWER = "";
let STRANGER = "";
let tripId = "";
let dayId = "";
let stopId = "";

beforeEach(async () => {
  const run = randomUUID().slice(0, 8);
  OWNER = `dev-owner-${run}`;
  SUGGESTER = `dev-sam-${run}`;
  OTHER_SUGGESTER = `dev-sue-${run}`;
  EDITOR = `dev-eddie-${run}`;
  VIEWER = `dev-vera-${run}`;
  STRANGER = `dev-stan-${run}`;
  // The collaboration gate caps every granted role to viewer for a free owner
  // (M20 link 6); this suite is about suggestions, so its owner may collaborate.
  await entitleAccounts([OWNER]);

  tripId = randomUUID();
  dayId = randomUUID();
  stopId = randomUUID();
  expect((await executeTripCommand({ type: "CreateTrip", tripId, name: "Kyoto" }, OWNER)).ok).toBe(true);
  const seeded = await executeTripCommandBatch(
    [
      { type: "AddDay", tripId, dayId },
      { type: "AddActivity", tripId, activityId: stopId, dayId, title: "Fushimi Inari" },
    ],
    OWNER,
  );
  expect(seeded.ok).toBe(true);

  const grants: [string, "suggester" | "editor" | "viewer"][] = [
    [SUGGESTER, "suggester"],
    [OTHER_SUGGESTER, "suggester"],
    [EDITOR, "editor"],
    [VIEWER, "viewer"],
  ];
  for (const [userId, role] of grants) {
    await grantMembership(db, { tripId, userId, role, invitedBy: OWNER, now: new Date().toISOString() });
  }
});

// Identities are per test, so the one `users` row `entitleAccounts` minted would
// otherwise accumulate in Identity forever.
afterEach(async () => {
  await db.delete(users).where(inArray(users.id, [OWNER]));
});

const rename = (name: string): BatchableCommand => ({ type: "SetTripName", tripId, name });
const draft = (...units: BatchableCommand[][]): CreateSuggestionInput => ({
  units: units.map((commands) => ({ commands })),
});

async function storedChanges(): Promise<number> {
  const rows = await db.select().from(tripSuggestionChanges).where(eq(tripSuggestionChanges.tripId, tripId));
  return rows.length;
}

async function suggest(input: CreateSuggestionInput, author = SUGGESTER) {
  const created = await createSuggestion(tripId, author, input);
  if (!created.ok) throw new Error(`seeding a suggestion failed: ${JSON.stringify(created.error)}`);
  return created.value;
}

async function statusOf(changeId: string): Promise<string | undefined> {
  const rows = await db.select().from(tripSuggestionChanges).where(eq(tripSuggestionChanges.id, changeId));
  return rows[0]?.status;
}

describe("createSuggestion", () => {
  it("is refused to everyone but a suggester, and stores nothing", async () => {
    const input = draft([rename("Kyoto in spring")]);
    for (const actor of [VIEWER, EDITOR, OWNER]) {
      expect(await createSuggestion(tripId, actor, input)).toMatchObject({ ok: false, error: { code: "forbidden" } });
    }
    expect(await createSuggestion(tripId, STRANGER, input)).toMatchObject({
      ok: false,
      error: { code: "not-found" },
    });
    expect(await storedChanges()).toBe(0);
  });

  it("refuses a draft with a unit that does not apply, names it, and stores nothing", async () => {
    const result = await createSuggestion(
      tripId,
      SUGGESTER,
      draft([rename("Kyoto in spring")], [{ type: "RemoveActivity", tripId, activityId: randomUUID() }]),
    );
    expect(result).toMatchObject({ ok: false, error: { code: "does-not-apply", index: 1 } });
    expect(await storedChanges()).toBe(0);
  });

  // W51: the dry run skips a sub-command that is already true, as accepting
  // it will, so a gesture that includes one is not refused for it.
  it("takes a unit with a no-op sub-command, which accepting then applies", async () => {
    const unit: BatchableCommand[] = [
      { type: "MoveActivity", tripId, activityId: stopId, toDayId: dayId, position: 0 },
      { type: "UpdateActivity", tripId, activityId: stopId, timeWindow: { start: "07:00", end: "08:00" } },
    ];
    const created = await createSuggestion(tripId, SUGGESTER, draft(unit));
    expect(created).toMatchObject({ ok: true, value: [{ status: "pending" }] });
    if (!created.ok) return;
    expect(await resolveSuggestionChange(tripId, created.value[0]!.id, OWNER, "accept")).toMatchObject({
      ok: true,
      value: [{ status: "accepted" }],
    });
  });

  it("refuses a unit that is a no-op throughout, and stores nothing", async () => {
    const result = await createSuggestion(tripId, SUGGESTER, draft([rename("Kyoto")]));
    expect(result).toMatchObject({ ok: false, error: { code: "does-not-apply", index: 0 } });
    expect(await storedChanges()).toBe(0);
  });

  it("refuses a command aimed at another trip, which accepting would run with the reviewer's rights", async () => {
    const elsewhere = randomUUID();
    const result = await createSuggestion(tripId, SUGGESTER, draft([{ type: "SetTripName", tripId: elsewhere, name: "Mine" }]));
    expect(result).toMatchObject({ ok: false, error: { code: "invalid" } });
    expect(await storedChanges()).toBe(0);
  });

  it("stores one change per unit, each described against the trip the units before it left", async () => {
    const newDay = randomUUID();
    const tea = randomUUID();
    const [addDay, addTea] = await suggest({
      ...draft(
        [{ type: "AddDay", tripId, dayId: newDay }],
        [{ type: "AddActivity", tripId, activityId: tea, dayId: newDay, title: "Tea ceremony" }],
      ),
      note: "For the slow day",
    });
    // "Day 2" exists only in the predicted detail of the first unit: the
    // second unit applied, and was described, on top of it.
    expect(addDay).toMatchObject({ description: "Added Day 2", dependsOn: [], status: "pending", note: "For the slow day" });
    expect(addTea).toMatchObject({ description: 'Added "Tea ceremony" to Day 2', dependsOn: [addDay!.id] });
    const [stored] = await db.select().from(tripSuggestions).where(eq(tripSuggestions.id, addDay!.suggestionId));
    // The head both units were checked against: TripCreated, DayAdded, ActivityAdded.
    expect(stored).toMatchObject({ authorId: SUGGESTER, baseSeq: 3 });
  });
});

describe("listSuggestionChanges", () => {
  it("shows a suggester their own changes, a reviewer everyone's, and a viewer or stranger nothing", async () => {
    const [mine] = await suggest(draft([rename("Sam's Kyoto")]));
    const [theirs] = await suggest(draft([rename("Sue's Kyoto")]), OTHER_SUGGESTER);

    const own = await listSuggestionChanges(tripId, SUGGESTER);
    expect(own.ok && own.value.changes.map((c) => c.id)).toEqual([mine!.id]);
    for (const reviewer of [EDITOR, OWNER]) {
      const all = await listSuggestionChanges(tripId, reviewer);
      expect(all.ok && all.value.changes.map((c) => c.id)).toEqual([mine!.id, theirs!.id]);
    }
    for (const outsider of [VIEWER, STRANGER]) {
      expect(await listSuggestionChanges(tripId, outsider)).toMatchObject({ ok: false, error: { code: "not-found" } });
    }
  });

  it("reports the same revision the events poll does, scoped the same way, and none to a viewer", async () => {
    await suggest(draft([rename("Sam's Kyoto")]));
    await suggest(draft([rename("Sue's Kyoto")]), OTHER_SUGGESTER);
    const own = await listSuggestionChanges(tripId, SUGGESTER);
    const all = await listSuggestionChanges(tripId, OWNER);
    if (!own.ok || !all.ok) throw new Error("list refused");
    expect(await suggestionsRevFor(tripId, SUGGESTER)).toBe(own.value.rev);
    expect(await suggestionsRevFor(tripId, OWNER)).toBe(all.value.rev);
    expect(own.value.rev).not.toBe(all.value.rev);
    expect(await suggestionsRevFor(tripId, VIEWER)).toBeUndefined();
    expect(await suggestionsRevFor(tripId, STRANGER)).toBeUndefined();
    expect(await suggestionsRevFor(tripId, null)).toBeUndefined();
  });

  it("moves the revision when a change is resolved", async () => {
    const [change] = await suggest(draft([rename("Sam's Kyoto")]));
    const before = await suggestionsRevFor(tripId, SUGGESTER);
    await resolveSuggestionChange(tripId, change!.id, OWNER, "dismiss");
    expect(await suggestionsRevFor(tripId, SUGGESTER)).not.toBe(before);
  });
});

describe("resolveSuggestionChange — accept", () => {
  it("appends one batch as the reviewer, says who asked, and marks the change accepted", async () => {
    const [change] = await suggest(draft([rename("Kyoto in spring")]));
    const result = await resolveSuggestionChange(tripId, change!.id, EDITOR, "accept");
    expect(result).toMatchObject({ ok: true, value: [{ id: change!.id, status: "accepted", resolvedBy: EDITOR }] });

    const last = (await readStream(db, tripId)).at(-1)!;
    expect(last.actorId).toBe(EDITOR);
    expect(last.origin).toEqual({
      kind: "suggestion",
      suggestionId: change!.suggestionId,
      changeId: change!.id,
      authorId: SUGGESTER,
    });
    expect(await statusOf(change!.id)).toBe("accepted");
  });

  it("answers a second accept with already-resolved, and the trip gains exactly one batch", async () => {
    const [change] = await suggest(draft([rename("Kyoto in spring")]));
    const before = (await readStream(db, tripId)).length;
    expect((await resolveSuggestionChange(tripId, change!.id, EDITOR, "accept")).ok).toBe(true);
    expect(await resolveSuggestionChange(tripId, change!.id, OWNER, "accept")).toMatchObject({
      ok: false,
      error: { code: "already-resolved" },
    });
    expect((await readStream(db, tripId)).length).toBe(before + 1);
  });

  // The race the conditional UPDATE exists for: the change is resolved by
  // someone else while this accept's batch is already in flight. The accept
  // read `pending`; only the hook can still stop it, and stopping it has to
  // take the batch down too.
  it("rolls its batch back when the change is resolved while the batch is in flight", async () => {
    const [change] = await suggest(draft([rename("Kyoto in spring")]));
    const before = (await readStream(db, tripId)).length;

    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const isLocked = new Promise<void>((resolve) => (locked = resolve));
    const rival = db.transaction(async (tx) => {
      await tx.select().from(tripSuggestionChanges).where(eq(tripSuggestionChanges.id, change!.id)).for("update");
      locked();
      await gate;
      await tx
        .update(tripSuggestionChanges)
        .set({ status: "dismissed", resolvedBy: OWNER, resolvedAt: new Date() })
        .where(eq(tripSuggestionChanges.id, change!.id));
    });
    await isLocked;

    const accepting = resolveSuggestionChange(tripId, change!.id, EDITOR, "accept");
    await waitForABlockedBackend("trip_suggestion_changes");
    release();
    await rival;

    expect(await accepting).toMatchObject({ ok: false, error: { code: "already-resolved" } });
    expect((await readStream(db, tripId)).length).toBe(before);
    expect(await statusOf(change!.id)).toBe("dismissed");
  });

  it("refuses a change before the change it builds on, and takes it after", async () => {
    const newDay = randomUUID();
    const [addDay, addTea] = await suggest(
      draft(
        [{ type: "AddDay", tripId, dayId: newDay }],
        [{ type: "AddActivity", tripId, activityId: randomUUID(), dayId: newDay, title: "Tea ceremony" }],
      ),
    );
    expect(await resolveSuggestionChange(tripId, addTea!.id, OWNER, "accept")).toMatchObject({
      ok: false,
      error: { code: "dependency-pending" },
    });
    expect(await statusOf(addTea!.id)).toBe("pending");

    expect((await resolveSuggestionChange(tripId, addDay!.id, OWNER, "accept")).ok).toBe(true);
    expect((await resolveSuggestionChange(tripId, addTea!.id, OWNER, "accept")).ok).toBe(true);
  });

  // Dismiss as well as accept: an accept would also be refused by the
  // pipeline's own authorization, but a dismiss writes no batch, so this
  // module's role check is the only thing between a capped editor and it.
  it("refuses an editor a lapse has capped to viewer", async () => {
    const [change] = await suggest(draft([rename("Kyoto in spring")]));
    await db.update(users).set({ planId: "free" }).where(eq(users.id, OWNER));
    for (const action of ["accept", "dismiss"] as const) {
      expect(await resolveSuggestionChange(tripId, change!.id, EDITOR, action)).toMatchObject({
        ok: false,
        error: { code: "forbidden" },
      });
    }
    expect(await statusOf(change!.id)).toBe("pending");
  });

  it("leaves a change pending when the trip no longer takes it (W10)", async () => {
    const [change] = await suggest(draft([{ type: "UpdateActivity", tripId, activityId: stopId, title: "Inari at dawn" }]));
    expect((await executeTripCommand({ type: "RemoveActivity", tripId, activityId: stopId }, OWNER)).ok).toBe(true);
    const before = (await readStream(db, tripId)).length;

    expect(await resolveSuggestionChange(tripId, change!.id, EDITOR, "accept")).toMatchObject({
      ok: false,
      error: { code: "no-longer-applies" },
    });
    expect(await statusOf(change!.id)).toBe("pending");
    expect((await readStream(db, tripId)).length).toBe(before);
  });
});

describe("resolveSuggestionChange — dismiss and withdraw", () => {
  it("dismissing a parent dismisses everything built on it, and nothing else", async () => {
    const newDay = randomUUID();
    const tea = randomUUID();
    const [addDay, addTea, renameTea, unrelated] = await suggest(
      draft(
        [{ type: "AddDay", tripId, dayId: newDay }],
        [{ type: "AddActivity", tripId, activityId: tea, dayId: newDay, title: "Tea ceremony" }],
        [{ type: "UpdateActivity", tripId, activityId: tea, title: "Matcha" }],
        [rename("Kyoto in spring")],
      ),
    );
    const result = await resolveSuggestionChange(tripId, addDay!.id, OWNER, "dismiss");
    expect(result.ok && result.value.map((c) => [c.id, c.status])).toEqual([
      [addDay!.id, "dismissed"],
      [addTea!.id, "dismissed"],
      [renameTea!.id, "dismissed"],
    ]);
    expect(await statusOf(unrelated!.id)).toBe("pending");
  });

  it("is refused to a suggester for a reviewer's action", async () => {
    const [change] = await suggest(draft([rename("Kyoto in spring")]));
    expect(await resolveSuggestionChange(tripId, change!.id, SUGGESTER, "dismiss")).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
  });

  it("lets only the author withdraw", async () => {
    const [change] = await suggest(draft([rename("Kyoto in spring")]));
    // Another suggester cannot see it at all; an editor can, and is refused.
    expect(await resolveSuggestionChange(tripId, change!.id, OTHER_SUGGESTER, "withdraw")).toMatchObject({
      ok: false,
      error: { code: "not-found" },
    });
    expect(await resolveSuggestionChange(tripId, change!.id, EDITOR, "withdraw")).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
    expect(await statusOf(change!.id)).toBe("pending");

    expect(await resolveSuggestionChange(tripId, change!.id, SUGGESTER, "withdraw")).toMatchObject({
      ok: true,
      value: [{ id: change!.id, status: "withdrawn", resolvedBy: SUGGESTER }],
    });
  });
});

/**
 * Resolves once a backend in this database is parked on a lock while running a
 * statement against `table` — `invites.int.test.ts`'s barrier, for the same
 * reason: polled, never slept, and specific to the statement it waits for.
 */
async function waitForABlockedBackend(table: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const pattern = `%${table}%`;
  for (;;) {
    const blocked = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from pg_stat_activity
       where datname = current_database()
         and state = 'active'
         and wait_event_type = 'Lock'
         and query ilike ${pattern}
    `);
    if (Number(blocked.rows[0]?.n ?? 0) > 0) return;
    if (Date.now() > deadline) throw new Error(`no backend ever blocked on a ${table} row`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

