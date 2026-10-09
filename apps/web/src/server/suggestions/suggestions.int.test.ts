import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BatchableCommand, CreateSuggestionInput } from "@tc/contracts";
import { executeTripCommand, executeTripCommandBatch } from "../commands";
import { grantMembership } from "../access/members";
import { db } from "../db/client";
import { tripDetails, tripSuggestionChanges, tripSuggestions, users } from "../db/schema";
import { readStream } from "../eventStore";
import { getTripHistory } from "../history";
import { getTripDetail } from "../projections";
import { entitleAccounts } from "../test-support/entitledAccount";
import { insertStoredSuggestion, unparseableCommands } from "../test-support/storedSuggestion";
import { acceptSuggestionChanges } from "./accept";
import { createSuggestion } from "./create";
import { listSuggestionChanges } from "./list";
import { resolveSuggestionChange } from "./resolve";
import { suggestionsRevForRole } from "./rev";
import { roleOn, SUGGESTION_AUTHOR_PENDING_MAX, SUGGESTION_TRIP_PENDING_MAX, SUGGESTION_TTL_DAYS } from "./shared";

// `roleOn` asks the access seam, whose module also holds the session-reading
// wrapper. Nothing here reads a session; this keeps next-auth out of the run.
vi.mock("@/server/auth", () => ({ auth: vi.fn(async () => null) }));

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

// The poll's revision as the events route asks for it: with the role
// `requireTripAccess` resolved, which is `roleOn`'s effective role.
async function revFor(userId: string): Promise<string | undefined> {
  const role = await roleOn(tripId, userId);
  return suggestionsRevForRole(tripId, userId, role.ok ? role.value : null);
}

/** `days` days and `minutes` minutes before now; a negative `minutes` is that much younger. */
const daysAgo = (days: number, minutes = 0) => new Date(Date.now() - days * 86_400_000 - minutes * 60_000);

async function statusOf(changeId: string): Promise<string | undefined> {
  const rows = await db.select().from(tripSuggestionChanges).where(eq(tripSuggestionChanges.id, changeId));
  return rows[0]?.status;
}

describe("createSuggestion", () => {
  // ADR-067 decision 1 relaxed spec §2.7: an editor or the owner may suggest
  // too, and is reviewed exactly like a suggester. A viewer still may not.
  it("is refused to a viewer and a stranger, and stores nothing for either", async () => {
    const input = draft([rename("Kyoto in spring")]);
    expect(await createSuggestion(tripId, VIEWER, input)).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(await createSuggestion(tripId, STRANGER, input)).toMatchObject({
      ok: false,
      error: { code: "not-found" },
    });
    expect(await storedChanges()).toBe(0);
  });

  it("takes a suggestion from an editor and from the owner, which another editor lists", async () => {
    const fromEditor = await suggest(draft([rename("Kyoto in spring")]), EDITOR);
    const fromOwner = await suggest(draft([rename("Kyoto in autumn")]), OWNER);
    const listed = await listSuggestionChanges(tripId, OWNER);
    expect(listed.ok && listed.value.changes.map((c) => [c.id, c.authorId])).toEqual([
      [fromEditor[0]!.id, EDITOR],
      [fromOwner[0]!.id, OWNER],
    ]);
    // A person's own draft says nothing about the assistant.
    expect(listed.ok && listed.value.changes.every((c) => c.via === undefined)).toBe(true);
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

// W56. What a unit creates is what its dry run created, not what its commands
// name: `SetTripDates.newDayIds` is a pool the decider takes only the prefix it
// needs from. And a range edit is decided against the day count, so it waits
// for every earlier unit that changed it.
describe("createSuggestion — dependencies", () => {
  const range = (endDate: string, newDayIds: string[]): BatchableCommand => ({
    type: "SetTripDates",
    tripId,
    startDate: "2027-05-01",
    endDate,
    newDayIds,
  });

  it("makes a range edit wait for the edit that set the day count it builds on", async () => {
    const [oneToTwo, twoToThree] = await suggest(
      draft([range("2027-05-02", [randomUUID()])], [range("2027-05-03", [randomUUID()])]),
    );
    expect(twoToThree!.dependsOn).toEqual([oneToTwo!.id]);
    // First, on a one-day trip, it would need two new days and has one id.
    expect(await resolveSuggestionChange(tripId, twoToThree!.id, OWNER, "accept")).toMatchObject({
      ok: false,
      error: { code: "dependency-pending" },
    });
    const dismissed = await resolveSuggestionChange(tripId, oneToTwo!.id, OWNER, "dismiss");
    expect(dismissed.ok && dismissed.value.map((c) => c.id)).toEqual([oneToTwo!.id, twoToThree!.id]);
  });

  it("does not make an id the dry run never used into something a later unit builds on", async () => {
    // A start-only change takes no day from its pool, so naming an existing
    // day there creates nothing — and a stop added to that day needs nothing.
    const [startOnly, addStop] = await suggest(
      draft(
        [{ type: "SetTripDates", tripId, startDate: "2027-05-01", endDate: null, newDayIds: [dayId] }],
        [{ type: "AddActivity", tripId, activityId: randomUUID(), dayId, title: "Tea ceremony" }],
      ),
    );
    expect(addStop!.dependsOn).toEqual([]);
    expect((await resolveSuggestionChange(tripId, startOnly!.id, OWNER, "dismiss")).ok).toBe(true);
    expect(await statusOf(addStop!.id)).toBe("pending");
  });

  // Review of #308: the draft moved a stop into a day, then removed the day.
  // Removing it first would leave the move nowhere to go.
  it("makes removing a day wait for the move into it", async () => {
    const second = randomUUID();
    expect((await executeTripCommand({ type: "AddDay", tripId, dayId: second }, OWNER)).ok).toBe(true);
    const [move, removeDay] = await suggest(
      draft(
        [{ type: "MoveActivity", tripId, activityId: stopId, toDayId: second, position: 0 }],
        [{ type: "RemoveDay", tripId, dayId: second }],
      ),
    );
    expect(removeDay!.dependsOn).toEqual([move!.id]);
    expect(await resolveSuggestionChange(tripId, removeDay!.id, OWNER, "accept")).toMatchObject({
      ok: false,
      error: { code: "dependency-pending" },
    });
    expect((await resolveSuggestionChange(tripId, move!.id, OWNER, "accept")).ok).toBe(true);
    expect((await resolveSuggestionChange(tripId, removeDay!.id, OWNER, "accept")).ok).toBe(true);
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

  // The role comes through the access seam, which answers a stored trip it
  // cannot parse as a denial. Here that denial is a refusal, not a throw.
  it("refuses, rather than throws, on a trip whose stored document does not parse", async () => {
    const [change] = await suggest(draft([rename("Sam's Kyoto")]));
    await db
      .update(tripDetails)
      .set({ doc: { tripId, name: 7 } as unknown as never })
      .where(eq(tripDetails.tripId, tripId));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(listSuggestionChanges(tripId, OWNER)).resolves.toMatchObject({
      ok: false,
      error: { code: "malformed-trip" },
    });
    await expect(resolveSuggestionChange(tripId, change!.id, OWNER, "dismiss")).resolves.toMatchObject({
      ok: false,
      error: { code: "malformed-trip" },
    });
    errors.mockRestore();
    expect(await statusOf(change!.id)).toBe("pending");
  });

  it("reports the same revision the events poll does, scoped the same way, and none to a viewer", async () => {
    await suggest(draft([rename("Sam's Kyoto")]));
    await suggest(draft([rename("Sue's Kyoto")]), OTHER_SUGGESTER);
    const own = await listSuggestionChanges(tripId, SUGGESTER);
    const all = await listSuggestionChanges(tripId, OWNER);
    if (!own.ok || !all.ok) throw new Error("list refused");
    expect(await revFor(SUGGESTER)).toBe(own.value.rev);
    expect(await revFor(OWNER)).toBe(all.value.rev);
    expect(own.value.rev).not.toBe(all.value.rev);
    expect(await revFor(VIEWER)).toBeUndefined();
    expect(await revFor(STRANGER)).toBeUndefined();
  });

  // W53: the list is read every time the poll's revision moves, so it carries
  // only what can still be decided, and a trip's resolved history never grows it.
  it("lists pending changes only, and a resolution still moves the revision", async () => {
    const [kept, accepted] = await suggest(draft([rename("Sam's Kyoto")], [{ type: "AddDay", tripId, dayId: randomUUID() }]));
    const before = await listSuggestionChanges(tripId, OWNER);
    expect((await resolveSuggestionChange(tripId, accepted!.id, OWNER, "accept")).ok).toBe(true);

    const after = await listSuggestionChanges(tripId, OWNER);
    if (!before.ok || !after.ok) throw new Error("list refused");
    expect(after.value.changes.map((c) => c.id)).toEqual([kept!.id]);
    expect(after.value.rev).not.toBe(before.value.rev);
    expect(await revFor(OWNER)).toBe(after.value.rev);
  });

  it("moves the revision when a change is resolved", async () => {
    const [change] = await suggest(draft([rename("Sam's Kyoto")]));
    const before = await revFor(SUGGESTER);
    await resolveSuggestionChange(tripId, change!.id, OWNER, "dismiss");
    expect(await revFor(SUGGESTER)).not.toBe(before);
  });
});

// Review of #308. A stored row is whatever a past release wrote; a command
// that has since left `BatchableCommand` must not take the whole list down
// with it, and the one thing a reviewer can still do with it is be rid of it.
describe("a stored change whose commands no longer parse", () => {
  const insertUnparseable = async (): Promise<string> =>
    (await insertStoredSuggestion({ tripId, authorId: SUGGESTER, commands: unparseableCommands(tripId) }))[0]!;

  it("is left out of the list and logged, while the revision still agrees with the poll's", async () => {
    const [good] = await suggest(draft([rename("Sam's Kyoto")]));
    const bad = await insertUnparseable();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const listed = await listSuggestionChanges(tripId, OWNER);
    expect(listed.ok && listed.value.changes.map((c) => c.id)).toEqual([good!.id]);
    expect(errors).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ changeId: bad }));
    errors.mockRestore();
    expect(listed.ok && listed.value.rev).toBe(await revFor(OWNER));
  });

  it("can still be dismissed or withdrawn by id, and an accept is refused with the row left pending", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const accepted = await insertUnparseable();
    expect(await resolveSuggestionChange(tripId, accepted, OWNER, "accept")).toMatchObject({
      ok: false,
      error: { code: "no-longer-applies" },
    });
    expect(await statusOf(accepted)).toBe("pending");

    expect((await resolveSuggestionChange(tripId, accepted, OWNER, "dismiss")).ok).toBe(true);
    expect(await statusOf(accepted)).toBe("dismissed");
    const withdrawn = await insertUnparseable();
    expect((await resolveSuggestionChange(tripId, withdrawn, SUGGESTER, "withdraw")).ok).toBe(true);
    expect(await statusOf(withdrawn)).toBe("withdrawn");
    errors.mockRestore();
  });
});

// Mitchell, 2026-10-03: at most 50 open changes per author and 200 per trip,
// counting the draft being sent.
describe("createSuggestion — caps", () => {
  const units = (n: number) => draft(...Array.from({ length: n }, (_, i) => [rename(`Kyoto ${i}`)]));

  it("refuses an author past 50 open changes, counting the draft, and stores nothing", async () => {
    await insertStoredSuggestion({ tripId, authorId: SUGGESTER, changes: SUGGESTION_AUTHOR_PENDING_MAX - 1 });
    expect(await createSuggestion(tripId, SUGGESTER, units(2))).toMatchObject({
      ok: false,
      error: { code: "too-many-pending" },
    });
    expect(await storedChanges()).toBe(SUGGESTION_AUTHOR_PENDING_MAX - 1);
    expect((await createSuggestion(tripId, SUGGESTER, units(1))).ok).toBe(true);
    // Another author's own count is their own.
    expect((await createSuggestion(tripId, OTHER_SUGGESTER, units(2))).ok).toBe(true);
  });

  it("refuses anyone past 200 open changes on the trip, counting the draft", async () => {
    // Inserted directly, so no author cap stood in the way of one author holding them.
    await insertStoredSuggestion({ tripId, authorId: OTHER_SUGGESTER, changes: SUGGESTION_TRIP_PENDING_MAX - 1 });
    expect(await createSuggestion(tripId, SUGGESTER, units(2))).toMatchObject({
      ok: false,
      error: { code: "too-many-pending" },
    });
    expect((await createSuggestion(tripId, SUGGESTER, units(1))).ok).toBe(true);
    expect(await createSuggestion(tripId, SUGGESTER, units(1))).toMatchObject({
      ok: false,
      error: { code: "too-many-pending" },
    });
  });

  // ADR-067 decision 3: an assistant turn is one request, whatever it holds,
  // and its author did not draft it change by change.
  it("lets an assistant suggestion past the author's cap, and does not count it toward the author's own drafts", async () => {
    await insertStoredSuggestion({ tripId, authorId: EDITOR, changes: SUGGESTION_AUTHOR_PENDING_MAX, via: "assistant" });
    const viaAssistant = await createSuggestion(tripId, EDITOR, units(3), undefined, { via: "assistant" });
    expect(viaAssistant.ok && viaAssistant.value.map((c) => c.via)).toEqual(["assistant", "assistant", "assistant"]);
    // 53 open from the assistant, none drafted by hand: a draft of 50 still fits.
    expect((await createSuggestion(tripId, EDITOR, units(SUGGESTION_AUTHOR_PENDING_MAX))).ok).toBe(true);
    expect(await createSuggestion(tripId, EDITOR, units(1))).toMatchObject({ ok: false, error: { code: "too-many-pending" } });
  });

  it("holds an assistant suggestion to the trip's cap, and stores none of it", async () => {
    await insertStoredSuggestion({ tripId, authorId: OTHER_SUGGESTER, changes: SUGGESTION_TRIP_PENDING_MAX - 1 });
    expect(await createSuggestion(tripId, EDITOR, units(2), undefined, { via: "assistant" })).toMatchObject({
      ok: false,
      error: { code: "too-many-pending" },
    });
    expect(await storedChanges()).toBe(SUGGESTION_TRIP_PENDING_MAX - 1);
  });

  it("does not count a resolved or an expired change", async () => {
    const [dismissed] = await insertStoredSuggestion({ tripId, authorId: SUGGESTER, changes: SUGGESTION_AUTHOR_PENDING_MAX });
    expect((await resolveSuggestionChange(tripId, dismissed!, OWNER, "dismiss")).ok).toBe(true);
    await insertStoredSuggestion({ tripId, authorId: SUGGESTER, changes: SUGGESTION_AUTHOR_PENDING_MAX, createdAt: daysAgo(91) });
    // 49 open: the dismissed one's 49 siblings. One more fits; two do not.
    expect((await createSuggestion(tripId, SUGGESTER, units(1))).ok).toBe(true);
    expect(await createSuggestion(tripId, SUGGESTER, units(1))).toMatchObject({ ok: false, error: { code: "too-many-pending" } });
  });
});

// Mitchell, 2026-10-03: a change nobody decides in 90 days stops being open.
describe("expiry", () => {
  it("leaves a change older than the TTL out of the list and the revision, and keeps one just younger", async () => {
    const [old] = await insertStoredSuggestion({ tripId, authorId: SUGGESTER, createdAt: daysAgo(SUGGESTION_TTL_DAYS, 1) });
    const [young] = await insertStoredSuggestion({ tripId, authorId: SUGGESTER, createdAt: daysAgo(SUGGESTION_TTL_DAYS, -1) });
    for (const reader of [OWNER, SUGGESTER]) {
      const listed = await listSuggestionChanges(tripId, reader);
      expect(listed.ok && listed.value.changes.map((c) => c.id)).toEqual([young]);
      expect(listed.ok && listed.value.rev).toBe(await revFor(reader));
    }
    expect(await statusOf(old!)).toBe("pending");
  });

  it("refuses accept, dismiss and withdraw on an expired change, and records it expired", async () => {
    for (const [actor, action] of [[OWNER, "accept"], [OWNER, "dismiss"], [SUGGESTER, "withdraw"]] as const) {
      const [aged] = await insertStoredSuggestion({ tripId, authorId: SUGGESTER, createdAt: daysAgo(91) });
      const before = (await readStream(db, tripId)).length;
      expect(await resolveSuggestionChange(tripId, aged!, actor, action)).toMatchObject({
        ok: false,
        error: { code: "expired" },
      });
      expect(await statusOf(aged!)).toBe("expired");
      expect((await readStream(db, tripId)).length).toBe(before);
      // And again, now that the row says so.
      expect(await resolveSuggestionChange(tripId, aged!, actor, action)).toMatchObject({ ok: false, error: { code: "expired" } });
    }
  });

  // Persisted lazily, inside whichever write on the trip's suggestions comes
  // next: there is no cron to sweep them (vercel.json declares none).
  it("records every aged change on the trip expired inside the next create, dismiss and accept", async () => {
    const [agedBeforeCreate] = await insertStoredSuggestion({ tripId, authorId: OTHER_SUGGESTER, createdAt: daysAgo(91) });
    const [toDismiss, toAccept] = await suggest(draft([rename("Sam's Kyoto")], [{ type: "AddDay", tripId, dayId: randomUUID() }]));
    expect(await statusOf(agedBeforeCreate!)).toBe("expired");

    const [agedBeforeDismiss] = await insertStoredSuggestion({ tripId, authorId: OTHER_SUGGESTER, createdAt: daysAgo(91) });
    expect((await resolveSuggestionChange(tripId, toDismiss!.id, OWNER, "dismiss")).ok).toBe(true);
    expect(await statusOf(agedBeforeDismiss!)).toBe("expired");

    const [agedBeforeAccept] = await insertStoredSuggestion({ tripId, authorId: OTHER_SUGGESTER, createdAt: daysAgo(91) });
    expect((await resolveSuggestionChange(tripId, toAccept!.id, OWNER, "accept")).ok).toBe(true);
    expect(await statusOf(agedBeforeAccept!)).toBe("expired");
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

  it("carries the assistant on the origin of a change it stored, so History can say so", async () => {
    const created = await createSuggestion(tripId, EDITOR, draft([rename("Kyoto in spring")]), undefined, { via: "assistant" });
    const [change] = created.ok ? created.value : [];
    expect((await resolveSuggestionChange(tripId, change!.id, OWNER, "accept")).ok).toBe(true);
    expect((await readStream(db, tripId)).at(-1)!.origin).toEqual({
      kind: "suggestion",
      suggestionId: change!.suggestionId,
      changeId: change!.id,
      authorId: EDITOR,
      via: "assistant",
    });
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

  // W52: the trip already says what the change asks for, so there is nothing
  // to append — and nothing to refuse either.
  it("accepts a change the trip already reflects, and appends nothing for it", async () => {
    const [first] = await suggest(draft([rename("Kyoto in spring")]));
    const [second] = await suggest(draft([rename("Kyoto in spring")]), OTHER_SUGGESTER);
    const before = (await readStream(db, tripId)).length;

    expect((await resolveSuggestionChange(tripId, first!.id, EDITOR, "accept")).ok).toBe(true);
    expect(await resolveSuggestionChange(tripId, second!.id, EDITOR, "accept")).toMatchObject({
      ok: true,
      value: [{ id: second!.id, status: "accepted", resolvedBy: EDITOR }],
    });
    expect(await statusOf(second!.id)).toBe("accepted");
    expect((await readStream(db, tripId)).length).toBe(before + 1);
  });

  // W55. "Already true" and "accepted" must be one fact. Here a trip write lands
  // after the accept decided the change was a no-op and before it marked it:
  // the change's row is held, so the accept parks at its mark, and the rename
  // commits meanwhile. Accepting it now would record a change the trip does not
  // say; what is left is to decide it again against the head that moved.
  it("decides a no-op change again when the trip moves before it is marked accepted", async () => {
    const [first] = await suggest(draft([rename("Kyoto in spring")]));
    const [second] = await suggest(draft([rename("Kyoto in spring")]), OTHER_SUGGESTER);
    expect((await resolveSuggestionChange(tripId, first!.id, EDITOR, "accept")).ok).toBe(true);

    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const isLocked = new Promise<void>((resolve) => (locked = resolve));
    const holder = db.transaction(async (tx) => {
      await tx.select().from(tripSuggestionChanges).where(eq(tripSuggestionChanges.id, second!.id)).for("update");
      locked();
      await gate;
    });
    await isLocked;

    const accepting = resolveSuggestionChange(tripId, second!.id, EDITOR, "accept");
    await waitForABlockedBackend("trip_suggestion_changes");
    expect((await executeTripCommand(rename("Osaka"), OWNER)).ok).toBe(true);
    release();
    await holder;

    expect(await accepting).toMatchObject({ ok: true, value: [{ id: second!.id, status: "accepted" }] });
    // Accepted on top of the rename, so the trip says what was accepted — and
    // the batch that made it so is the suggestion's.
    expect((await getTripDetail(tripId))?.name).toBe("Kyoto in spring");
    expect((await readStream(db, tripId)).at(-1)!.origin).toMatchObject({ kind: "suggestion", changeId: second!.id });
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

// M40 D1-D3. "Accept all" is one batch: one History entry, one undo, and a
// refusal anywhere lands nothing.
describe("acceptSuggestionChanges", () => {
  const addStop = (day: string, title: string): BatchableCommand[] => [
    { type: "AddActivity", tripId, activityId: randomUUID(), dayId: day, title },
  ];

  async function historyLength(): Promise<number> {
    return (await getTripHistory(tripId))!.entries.length;
  }

  it("accepts ten changes as one History entry, which one undo takes back whole, leaving them accepted", async () => {
    const newDay = randomUUID();
    // Sam's stops build on Sam's new day; Sue's go on the day the trip has.
    const fromSam = await suggest(draft([{ type: "AddDay", tripId, dayId: newDay }], ...[1, 2, 3, 4, 5].map((n) => addStop(newDay, `Sam ${n}`))));
    const fromSue = await suggest(draft(...[1, 2, 3, 4].map((n) => addStop(dayId, `Sue ${n}`))), OTHER_SUGGESTER);
    const all = [...fromSam, ...fromSue];
    expect(all).toHaveLength(10);
    const entriesBefore = await historyLength();
    const tripBefore = await getTripDetail(tripId);

    // Named children first: the server replays parents first regardless.
    const accepted = await acceptSuggestionChanges(tripId, all.map((c) => c.id).reverse(), EDITOR);
    expect(accepted.ok && accepted.value.map((c) => c.status)).toEqual(Array(10).fill("accepted"));

    const history = (await getTripHistory(tripId))!;
    expect(history.entries).toHaveLength(entriesBefore + 1);
    expect(history.entries[0]).toMatchObject({
      actorId: EDITOR,
      description: "Accepted 10 suggestions",
      origin: { kind: "suggestions", authorIds: [SUGGESTER, OTHER_SUGGESTER] },
    });
    expect((await getTripDetail(tripId))!.days).toHaveLength(2);

    expect((await executeTripCommand({ type: "UndoLastChange", tripId }, OWNER)).ok).toBe(true);
    const undone = (await getTripDetail(tripId))!;
    expect(undone.days.map((d) => d.dayId)).toEqual(tripBefore!.days.map((d) => d.dayId));
    expect(undone.days[0]!.activityIds).toEqual([stopId]);
    expect(Object.keys(undone.activities)).toEqual([stopId]);
    // D2: undo is compensating events and nothing else.
    for (const change of all) expect(await statusOf(change.id)).toBe("accepted");
  });

  it("says the assistant on an accept-all only when every change in it came through the assistant", async () => {
    const viaAssistant = async (title: string) => {
      const created = await createSuggestion(tripId, EDITOR, draft(addStop(dayId, title)), undefined, { via: "assistant" });
      if (!created.ok) throw new Error(JSON.stringify(created.error));
      return created.value[0]!.id;
    };
    const both = [await viaAssistant("Nishiki market"), await viaAssistant("Kiyomizu-dera")];
    expect((await acceptSuggestionChanges(tripId, both, OWNER)).ok).toBe(true);
    expect((await getTripHistory(tripId))!.entries[0]!.origin).toMatchObject({ kind: "suggestions", via: "assistant" });

    const [byHand] = await suggest(draft(addStop(dayId, "Gion")));
    const mixed = [await viaAssistant("Ponto-cho"), byHand!.id];
    expect((await acceptSuggestionChanges(tripId, mixed, OWNER)).ok).toBe(true);
    expect((await getTripHistory(tripId))!.entries[0]!.origin).not.toHaveProperty("via");
  });

  it("lands nothing when one change in the set is refused, and names that change", async () => {
    const [renamed, retitled] = await suggest(
      draft([rename("Kyoto in spring")], [{ type: "UpdateActivity", tripId, activityId: stopId, title: "Inari at dawn" }]),
    );
    expect((await executeTripCommand({ type: "RemoveActivity", tripId, activityId: stopId }, OWNER)).ok).toBe(true);
    const before = (await readStream(db, tripId)).length;

    const result = await acceptSuggestionChanges(tripId, [renamed!.id, retitled!.id], EDITOR);
    expect(result).toMatchObject({ ok: false, error: { code: "no-longer-applies", changeId: retitled!.id } });
    expect((await readStream(db, tripId)).length).toBe(before);
    expect(await statusOf(renamed!.id)).toBe("pending");
    expect(await statusOf(retitled!.id)).toBe("pending");
  });

  it("refuses a change whose pending parent is not in the set, and lands nothing", async () => {
    const newDay = randomUUID();
    const [addDay, addTea] = await suggest(draft([{ type: "AddDay", tripId, dayId: newDay }], addStop(newDay, "Tea ceremony")));
    const [renamed] = await suggest(draft([rename("Kyoto in spring")]), OTHER_SUGGESTER);
    const before = (await readStream(db, tripId)).length;

    expect(await acceptSuggestionChanges(tripId, [renamed!.id, addTea!.id], EDITOR)).toMatchObject({
      ok: false,
      error: { code: "dependency-pending", changeId: addTea!.id },
    });
    expect((await readStream(db, tripId)).length).toBe(before);
    for (const change of [addDay!, addTea!, renamed!]) expect(await statusOf(change.id)).toBe("pending");
  });

  it("refuses a resolved or unknown change by name, and a reviewer below editor", async () => {
    const [first, second] = await suggest(draft([rename("Kyoto in spring")], [rename("Kyoto in autumn")]));
    expect((await resolveSuggestionChange(tripId, first!.id, EDITOR, "dismiss")).ok).toBe(true);
    expect(await acceptSuggestionChanges(tripId, [first!.id, second!.id], EDITOR)).toMatchObject({
      ok: false,
      error: { code: "already-resolved", changeId: first!.id },
    });
    const unknown = randomUUID();
    expect(await acceptSuggestionChanges(tripId, [second!.id, unknown], EDITOR)).toMatchObject({
      ok: false,
      error: { code: "not-found", changeId: unknown },
    });
    expect(await acceptSuggestionChanges(tripId, [second!.id], SUGGESTER)).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
    expect(await statusOf(second!.id)).toBe("pending");
  });

  // W52, for the set: what every change asks for is already true.
  it("accepts a set the trip already reflects throughout, and appends nothing", async () => {
    const [first] = await suggest(draft([rename("Kyoto in spring")]));
    const [second] = await suggest(draft([rename("Kyoto in spring")]), OTHER_SUGGESTER);
    expect((await executeTripCommand(rename("Kyoto in spring"), OWNER)).ok).toBe(true);
    const before = (await readStream(db, tripId)).length;

    expect(await acceptSuggestionChanges(tripId, [first!.id, second!.id], EDITOR)).toMatchObject({
      ok: true,
      value: [{ id: first!.id, status: "accepted" }, { id: second!.id, status: "accepted" }],
    });
    expect((await readStream(db, tripId)).length).toBe(before);
    for (const change of [first!, second!]) expect(await statusOf(change.id)).toBe("accepted");
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

