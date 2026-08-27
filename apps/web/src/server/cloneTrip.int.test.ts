import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "./db/client";
import { pages } from "./db/schema";
import { executeTripCommand } from "./commands";
import { getTripDetail } from "./projections";
import { createPage } from "./pages";
import { cloneSharedTrip, duplicateTrip } from "./cloneTrip";
import { rebuildProjections } from "./projections";
import { acceptInvite, createInvite } from "./access/invites";
import { createShare, revokeShare } from "./access/shares";

const actor = "user-1";

// No beforeEach truncation: every test mints its own randomUUID() tripId and
// every assertion below reads back through that tripId (getTripDetail,
// duplicateTrip's own result, or a pages query scoped by result.tripId) —
// see eventStore.int.test.ts's comment and docs/testing-baseline.md for the
// isolation-strategy writeup (Phase 2 Task 2.6).
describe("duplicateTrip", () => {
  it("copies planning state into a fresh stream with fresh ids", async () => {
    const tripId = randomUUID();
    const dayId = randomUUID();
    const activityId = randomUUID();
    await executeTripCommand({ type: "CreateTrip", tripId, name: "Japan" }, actor);
    await executeTripCommand({ type: "AddDay", tripId, dayId }, actor);
    await executeTripCommand(
      { type: "AddActivity", tripId, activityId, dayId, title: "Ramen" },
      actor,
    );

    const result = await duplicateTrip(tripId, actor);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.detail.name).toBe("Japan (copy)");
    expect(result.detail.tripId).not.toBe(tripId);
    expect(result.detail.days).toHaveLength(1);
    // Fresh ids: reusing source ids across streams is the KI-1 hazard.
    expect(result.detail.days[0]!.dayId).not.toBe(dayId);
    expect(Object.keys(result.detail.activities)[0]).not.toBe(activityId);
    expect(Object.values(result.detail.activities)[0]!.title).toBe("Ramen");

    // The source is untouched.
    const source = await getTripDetail(tripId);
    expect(source!.days[0]!.dayId).toBe(dayId);
  });

  it("does not copy the source trip's pages", async () => {
    const tripId = randomUUID();
    await executeTripCommand({ type: "CreateTrip", tripId, name: "Japan" }, actor);
    await createPage(
      tripId,
      { title: "Packing", context: { tripId }, content: { type: "doc", content: [] } },
      actor,
    );

    const result = await duplicateTrip(tripId, actor);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Pages are a separate CRUD module (ADR-014); a duplicate copies planning
    // state only. Query the pages table directly rather than calling
    // listPages, which would lazily seed default pages on the destination
    // trip and mask "not copied" behind a false "not empty".
    const copied = await db.select().from(pages).where(eq(pages.tripId, result.tripId));
    expect(copied).toHaveLength(0);
  });

  it("refuses to duplicate a deleted trip", async () => {
    const tripId = randomUUID();
    await executeTripCommand({ type: "CreateTrip", tripId, name: "Gone" }, actor);
    await executeTripCommand({ type: "DeleteTrip", tripId }, actor);
    const result = await duplicateTrip(tripId, actor);
    expect(result.ok === false && result.error.code).toBe("trip-deleted");
  });
});

// ── M11 link 5: lineage, and cloning something that is not yours ────────────

describe("clone-with-lineage", () => {
  it("records which trip, which history point, and what it was called", async () => {
    const tripId = randomUUID();
    await executeTripCommand({ type: "CreateTrip", tripId, name: "Kyoto" }, actor);
    await executeTripCommand({ type: "AddDay", tripId, dayId: randomUUID() }, actor);

    const result = await duplicateTrip(tripId, actor);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.detail.forkedFrom).toEqual({ tripId, atSeq: 2, name: "Kyoto" });
  });

  it("leaves a trip that started from nothing with no lineage at all", async () => {
    const tripId = randomUUID();
    const created = await executeTripCommand({ type: "CreateTrip", tripId, name: "Fresh" }, actor);
    expect(created.ok && created.detail.forkedFrom).toBeNull();
  });

  // The ancestor's name is a SNAPSHOT stored in the genesis event, not a
  // lookup: the credit has to survive the original being renamed, deleted, or
  // never having been readable by whoever holds the copy.
  it("keeps the ancestor's name as it was, even after the ancestor is renamed", async () => {
    const tripId = randomUUID();
    await executeTripCommand({ type: "CreateTrip", tripId, name: "Kyoto" }, actor);
    const result = await duplicateTrip(tripId, actor);
    if (!result.ok) return;

    await executeTripCommand({ type: "SetTripName", tripId, name: "Osaka, actually" }, actor);

    const copy = await getTripDetail(result.tripId);
    expect(copy!.forkedFrom!.name).toBe("Kyoto");
  });

  it("does not inherit the ancestor's own lineage — a copy of a copy points at the copy", async () => {
    const rootId = randomUUID();
    await executeTripCommand({ type: "CreateTrip", tripId: rootId, name: "Root" }, actor);
    const first = await duplicateTrip(rootId, actor);
    if (!first.ok) return;
    const second = await duplicateTrip(first.tripId, actor);
    if (!second.ok) return;

    expect(second.detail.forkedFrom!.tripId).toBe(first.tripId);
    expect(second.detail.forkedFrom!.name).toBe("Root (copy)");
  });

  // Lineage lives in the genesis event, so it must survive a rebuild — the
  // thing that would otherwise quietly break AGENTS.md invariant 2.
  it("survives a projection rebuild", async () => {
    const tripId = randomUUID();
    await executeTripCommand({ type: "CreateTrip", tripId, name: "Kyoto" }, actor);
    const result = await duplicateTrip(tripId, actor);
    if (!result.ok) return;

    await rebuildProjections();

    const rebuilt = await getTripDetail(result.tripId);
    expect(rebuilt!.forkedFrom).toEqual({ tripId, atSeq: 1, name: "Kyoto" });
  });
});

describe("who may clone", () => {
  const bob = "clone-bob";

  it("lets an invited VIEWER duplicate — a copy takes nothing from the source", async () => {
    const tripId = randomUUID();
    await executeTripCommand({ type: "CreateTrip", tripId, name: "Kyoto" }, actor);
    const invite = await createInvite(tripId, actor, { email: null, role: "viewer" });
    await acceptInvite(invite.token, bob);

    const result = await duplicateTrip(tripId, bob);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // …and it is theirs, editable, because it is a new stream they created.
    expect(result.detail.members).toEqual([{ userId: bob, role: "owner" }]);
    expect((await executeTripCommand({ type: "AddDay", tripId: result.tripId, dayId: randomUUID() }, bob)).ok).toBe(true);
  });

  it("still refuses a stranger", async () => {
    const tripId = randomUUID();
    await executeTripCommand({ type: "CreateTrip", tripId, name: "Kyoto" }, actor);
    const result = await duplicateTrip(tripId, "clone-stranger");
    expect(result.ok === false && result.error.code).toBe("forbidden");
  });
});

describe("cloning a share link", () => {
  const stranger = "clone-stranger-2";

  it("copies the PINNED state, not what the trip has become since", async () => {
    const tripId = randomUUID();
    await executeTripCommand({ type: "CreateTrip", tripId, name: "Kyoto" }, actor);
    await executeTripCommand({ type: "AddDay", tripId, dayId: randomUUID() }, actor);
    const share = await createShare(tripId, actor);
    if (!share.ok) return;

    // The source moves on after the link is handed out.
    await executeTripCommand({ type: "AddDay", tripId, dayId: randomUUID() }, actor);
    await executeTripCommand({ type: "SetTripName", tripId, name: "Osaka" }, actor);

    const result = await cloneSharedTrip(share.value.token, stranger);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // One day, the old name — exactly what the link shows.
    expect(result.detail.days).toHaveLength(1);
    expect(result.detail.name).toBe("Kyoto (copy)");
    expect(result.detail.forkedFrom).toEqual({ tripId, atSeq: share.value.seq, name: "Kyoto" });
  });

  it("gives the clone to whoever cloned it, editable, with the source untouched", async () => {
    const tripId = randomUUID();
    await executeTripCommand({ type: "CreateTrip", tripId, name: "Kyoto" }, actor);
    const share = await createShare(tripId, actor);
    if (!share.ok) return;

    const result = await cloneSharedTrip(share.value.token, stranger);
    if (!result.ok) return;

    expect(result.detail.members).toEqual([{ userId: stranger, role: "owner" }]);
    expect((await executeTripCommand({ type: "AddDay", tripId: result.tripId, dayId: randomUUID() }, stranger)).ok).toBe(true);
    // The stranger is still nothing to the source.
    expect((await executeTripCommand({ type: "AddDay", tripId, dayId: randomUUID() }, stranger)).ok).toBe(false);
    expect((await getTripDetail(tripId))!.days).toHaveLength(0);
  });

  it("refuses an unknown token", async () => {
    const result = await cloneSharedTrip("nope", stranger);
    expect(result.ok === false && result.error.code).toBe("not-found");
  });

  it("refuses a link that has been turned off", async () => {
    const tripId = randomUUID();
    await executeTripCommand({ type: "CreateTrip", tripId, name: "Kyoto" }, actor);
    const share = await createShare(tripId, actor);
    if (!share.ok) return;
    await revokeShare(tripId, share.value.shareId);

    const result = await cloneSharedTrip(share.value.token, stranger);
    expect(result.ok === false && result.error.code).toBe("share-unavailable");
  });
});
