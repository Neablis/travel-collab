import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BatchableCommand } from "@tc/contracts";
import { executeTripCommand } from "@/server/commands";
import { getTripDetail } from "@/server/projections";
import { getTripHistory } from "@/server/history";
import { saveDay, setSavedDayVisibility } from "@/server/savedDays";
import { db } from "@/server/db/client";
import { rateLimitCounters, savedDayAdds, savedDays, tripMemberships } from "@/server/db/schema";
import { DEMO_TRIP_ID } from "@/lib/demoTrip";
import type { Geocoder, GeocodeResult } from "@/server/geocoding";

const ACTOR_ID = "apply-owner";
const VIEWER_ID = "apply-viewer";
const OUTSIDER_ID = "apply-outsider";

let currentUserId = ACTOR_ID;

vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

const { handleApplyProposalRequest } = await import("@/server/ai/handleAskRequest");
type ProposalApplyRecord = import("@/server/ai/handleAskRequest").ProposalApplyRecord;

async function seedTrip(): Promise<string> {
  const tripId = randomUUID();
  const create = await executeTripCommand({ type: "CreateTrip", tripId, name: "Kyoto 2027" }, ACTOR_ID);
  if (!create.ok) throw new Error("failed to seed trip");
  const dated = await executeTripCommand(
    {
      type: "SetTripDates",
      tripId,
      startDate: "2027-04-01",
      endDate: "2027-04-02",
      newDayIds: [randomUUID(), randomUUID()],
    },
    ACTOR_ID,
  );
  if (!dated.ok) throw new Error("failed to date trip");
  return tripId;
}

async function grantViewer(tripId: string, userId: string) {
  await db.insert(tripMemberships).values({
    tripId,
    userId,
    role: "viewer",
    invitedBy: ACTOR_ID,
    createdAt: new Date().toISOString(),
  });
}

// The default sink is `console.info`, and `test:int` should not be buried in
// per-approval log lines. Two tests below pass their own sink deliberately,
// which is what covers the record's contents.
const silent = () => {};

function req(tripId: string, body: unknown) {
  return new Request(`http://test/api/trips/${tripId}/ask/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function fakeGeocoder(responses: Record<string, GeocodeResult[]>): Geocoder {
  return { forward: vi.fn(async (query: string) => responses[query] ?? []) } as unknown as Geocoder;
}

// The playbook author (ADR-042). Per-run, because `saved_days` is never
// truncated and every ledger assertion below is "this day, these rows".
const AUTHOR_ID = `apply-playbook-author-${randomUUID().slice(0, 8)}`;

/** A trip with NO dates — the wishlist state `addCounts` refuses to credit. */
async function seedUndatedTrip(): Promise<string> {
  const tripId = randomUUID();
  const create = await executeTripCommand({ type: "CreateTrip", tripId, name: "Someday" }, ACTOR_ID);
  if (!create.ok) throw new Error("failed to seed undated trip");
  return tripId;
}

/**
 * A published two-stop saved day, owned by `ownerId`, built through the real
 * `saveDay` — not by writing a row — so what the apply path reads back is a day
 * the library itself would produce.
 */
async function publishedDay(ownerId: string, name = "A day in Kyoto"): Promise<string> {
  const tripId = randomUUID();
  const dayId = randomUUID();
  await executeTripCommand({ type: "CreateTrip", tripId, name: "Source" }, ownerId);
  await executeTripCommand({ type: "AddDay", tripId, dayId }, ownerId);
  for (const title of ["Fushimi Inari", "Nishiki Market"]) {
    await executeTripCommand(
      { type: "AddActivity", tripId, activityId: randomUUID(), dayId, title },
      ownerId,
    );
  }
  const saved = await saveDay({ name, dayId }, (await getTripDetail(tripId))!, ownerId);
  if (!saved.ok) throw new Error(`could not save the day: ${saved.error.message}`);
  const published = await setSavedDayVisibility(saved.value.savedDayId, ownerId, "public");
  if (published === null) throw new Error("could not publish the day");
  return saved.value.savedDayId;
}

/** The ledger itself — one row per (day, trip). */
const ledgerRows = (savedDayId: string) =>
  db.select().from(savedDayAdds).where(eq(savedDayAdds.savedDayId, savedDayId));

/**
 * The invariant the denormalised counter exists under: it is `count(*)` over
 * the ledger and nothing else may move it. Asserted beside every ledger check
 * below for the reason the saved-days suite gives — a counter that agrees on
 * the happy path and drifts on a refusal is exactly what this pairing is for.
 */
async function expectCounterMatchesLedger(savedDayId: string): Promise<number> {
  const rows = await ledgerRows(savedDayId);
  const counter = await db.select({ adds: savedDays.adds }).from(savedDays).where(eq(savedDays.id, savedDayId));
  expect(counter[0]!.adds).toBe(rows.length);
  return rows.length;
}

/** The two stops the simulated assistant proposes for day 1, already resolved. */
async function twoStopsOnDayOne(tripId: string): Promise<BatchableCommand[]> {
  const detail = await getTripDetail(tripId);
  const dayId = (detail as { days: { dayId: string }[] }).days[0]!.dayId;
  return [
    { type: "AddActivity", tripId, activityId: randomUUID(), dayId, title: "Sample: coffee stop" },
    { type: "AddActivity", tripId, activityId: randomUUID(), dayId, title: "Sample: evening stroll" },
  ];
}

describe("POST /api/trips/:id/ask/apply", () => {
  beforeEach(async () => {
    currentUserId = ACTOR_ID;
    await db.delete(rateLimitCounters);
  });

  describe("access", () => {
    it("401s when unauthenticated", async () => {
      const tripId = await seedTrip();
      currentUserId = "";
      const commands = await twoStopsOnDayOne(tripId);
      const res = await handleApplyProposalRequest(req(tripId, { commands }), tripId, undefined, silent);
      expect(res.status).toBe(401);
    });

    it("403s for a non-member", async () => {
      const tripId = await seedTrip();
      const commands = await twoStopsOnDayOne(tripId);
      currentUserId = OUTSIDER_ID;
      const res = await handleApplyProposalRequest(req(tripId, { commands }), tripId, undefined, silent);
      expect(res.status).toBe(403);
    });

    // The deliberate asymmetry with /ask: a viewer may ASK (the turn writes
    // nothing) and can never APPROVE. Both answers come out of the same
    // `minimumRoleFor` computation, applied to the tool set each half implies.
    it("403s a viewer, who /ask itself admits", async () => {
      const tripId = await seedTrip();
      const commands = await twoStopsOnDayOne(tripId);
      await grantViewer(tripId, VIEWER_ID);
      currentUserId = VIEWER_ID;
      const before = await getTripDetail(tripId);
      const res = await handleApplyProposalRequest(req(tripId, { commands }), tripId, undefined, silent);
      expect(res.status).toBe(403);
      expect(JSON.stringify(await getTripDetail(tripId))).toBe(JSON.stringify(before));
    });

    it("refuses the demo trip, before the guard", async () => {
      currentUserId = "";
      const res = await handleApplyProposalRequest(
        req(DEMO_TRIP_ID, { commands: [{ type: "AddDay", tripId: DEMO_TRIP_ID, dayId: randomUUID() }] }),
        DEMO_TRIP_ID,
        undefined,
        silent,
      );
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: "The assistant isn't available on the demo trip.",
        code: "demo-trip-unsupported",
      });
    });

    // Approving calls no model. Charging the caller's hourly AI allowance for
    // pressing a button would refuse them the next question over something no
    // provider ever saw.
    it("consumes no AI quota", async () => {
      const tripId = await seedTrip();
      const commands = await twoStopsOnDayOne(tripId);
      const res = await handleApplyProposalRequest(req(tripId, { commands }), tripId, undefined, silent);
      expect(res.status).toBe(200);
      expect(await db.select().from(rateLimitCounters)).toHaveLength(0);
    });
  });

  describe("the batch", () => {
    // ADR-013, and the requirement in one assertion: TWO commands, ONE new
    // history entry, one undo.
    it("commits the whole proposal as ONE atomic batch", async () => {
      const tripId = await seedTrip();
      const historyBefore = await getTripHistory(tripId);
      const commands = await twoStopsOnDayOne(tripId);

      const res = await handleApplyProposalRequest(req(tripId, { proposalId: "p1", commands }), tripId, undefined, silent);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        detail: { activities: Record<string, { title: string }> };
        history: { entries: { description: string }[]; canUndo: boolean };
        message: string;
      };

      expect(Object.values(body.detail.activities).map((a) => a.title).sort()).toEqual([
        "Sample: coffee stop",
        "Sample: evening stroll",
      ]);
      // One entry added, not two — proof both commands rode one batchId.
      expect(body.history.entries).toHaveLength(historyBefore!.entries.length + 1);
      // Both commands in ONE entry's description, joined by "; " — the
      // event-store's own proof that they shared a batchId.
      expect(body.history.entries[0]!.description).toBe(
        'Added "Sample: coffee stop" to Day 1; Added "Sample: evening stroll" to Day 1',
      );
      expect(body.history.canUndo).toBe(true);
      // The receipt is `summarizeBatch`'s — derived from the committed
      // commands, so it can never claim an edit the batch did not make.
      expect(body.message).toBe(
        "Done — added “Sample: coffee stop” to day 1 and added “Sample: evening stroll” to day 1.",
      );
    });

    it("undoes the whole proposal in one step", async () => {
      const tripId = await seedTrip();
      const commands = await twoStopsOnDayOne(tripId);
      await handleApplyProposalRequest(req(tripId, { commands }), tripId, undefined, silent);

      // ONE undo takes the whole proposal back off the board (ADR-013). Two
      // batches would have needed two.
      const undone = await executeTripCommand({ type: "UndoLastChange", tripId }, ACTOR_ID);
      expect(undone.ok).toBe(true);
      if (!undone.ok) return;
      expect(Object.keys(undone.detail.activities)).toHaveLength(0);
    });

    // Rejected, not re-stamped — the same answer POST /trips/:id/commands/batch
    // gives, because two doors onto one executor that disagree about what a
    // mismatch means is how one of them ends up being the wrong one.
    it("400s a command whose tripId disagrees with the URL, and writes to neither trip", async () => {
      const tripId = await seedTrip();
      const otherTrip = await seedTrip();
      const before = await getTripDetail(tripId);
      const otherBefore = await getTripDetail(otherTrip);
      const commands = (await twoStopsOnDayOne(tripId)).map((c) => ({ ...c, tripId: otherTrip }));

      const res = await handleApplyProposalRequest(req(tripId, { commands }), tripId, undefined, silent);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "a command tripId does not match the URL" });
      expect(JSON.stringify(await getTripDetail(tripId))).toBe(JSON.stringify(before));
      expect(JSON.stringify(await getTripDetail(otherTrip))).toBe(JSON.stringify(otherBefore));
    });

    // IMPORTANT 1 (review round 1). Enforced at this door too, so the guarantee
    // does not depend on the proposal having been built by our own code.
    it("stores NO cost for a stop whose approved command carried a fabricated zero", async () => {
      const tripId = await seedTrip();
      const detail = await getTripDetail(tripId);
      const dayId = (detail as { days: { dayId: string }[] }).days[0]!.dayId;
      const res = await handleApplyProposalRequest(
        req(tripId, {
          commands: [
            {
              type: "AddActivity",
              tripId,
              activityId: randomUUID(),
              dayId,
              title: "Priceless",
              cost: { amountMinor: 0, currency: "USD" },
            },
          ],
        }),
        tripId,
        undefined,
        silent,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { detail: { activities: Record<string, { cost: unknown }> } };
      // `null` is the projection's "no cost" (TripDetail.activities[].cost is
      // nullable) — unknown reading as unknown, not as `{ amountMinor: 0 }`,
      // which the board renders as free.
      expect(Object.values(body.detail.activities)[0]!.cost).toBeNull();
    });

    it("logs one record per approval, carrying the proposalId the client echoed", async () => {
      const tripId = await seedTrip();
      const commands = await twoStopsOnDayOne(tripId);
      const records: ProposalApplyRecord[] = [];
      const res = await handleApplyProposalRequest(req(tripId, { proposalId: "p-42", commands }), tripId, undefined, (r) =>
        records.push(r),
      );
      expect(res.status).toBe(200);
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        event: "ai.proposal.apply",
        tripId,
        userId: ACTOR_ID,
        proposalId: "p-42",
        commandCount: 2,
        outcome: "applied",
        code: null,
      });
      expect(records[0]!.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it("logs a refused batch as refused, with the domain's own code", async () => {
      const tripId = await seedTrip();
      const records: ProposalApplyRecord[] = [];
      await handleApplyProposalRequest(
        req(tripId, {
          commands: [{ type: "AddActivity", tripId, activityId: randomUUID(), dayId: randomUUID(), title: "Nowhere" }],
        }),
        tripId,
        undefined,
        (r) => records.push(r),
      );
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ outcome: "refused", proposalId: null });
      expect(records[0]!.code).not.toBeNull();
    });
  });

  // KI-15: approval must not become a second door that skips the enrichment
  // the command path runs. The rule there is "refine, never relocate" — a
  // lookup is accepted only if it agrees with what we already believe.
  describe("geocode enrichment", () => {
    const GEOCODED: GeocodeResult = {
      lat: 35.0116,
      lng: 135.7681,
      canonicalName: "Kyoto, Japan",
      countryCode: "JP",
    };

    it("runs on an approved batch, exactly as it does on the command path", async () => {
      const tripId = await seedTrip();
      const detail = await getTripDetail(tripId);
      const dayId = (detail as { days: { dayId: string }[] }).days[0]!.dayId;
      const geocoder = fakeGeocoder({ Kyoto: [GEOCODED] });
      const commands: BatchableCommand[] = [
        {
          type: "AddActivity",
          tripId,
          activityId: randomUUID(),
          dayId,
          title: "Coffee",
          // The model's own, imprecise guess — close enough to be refined.
          location: { name: "Kyoto", lat: 35.02, lng: 135.77, countryCode: "JP" },
        },
      ];

      const res = await handleApplyProposalRequest(req(tripId, { commands }), tripId, geocoder, silent);
      expect(res.status).toBe(200);
      // Region-biased, exactly as the command path calls it: the box comes
      // from the trip's own already-geocoded activities plus the model's hint
      // (KI-15's "refine, never relocate").
      expect(geocoder.forward).toHaveBeenCalledWith("Kyoto", expect.objectContaining({ limit: 1 }));
      const body = (await res.json()) as { detail: { activities: Record<string, { location: GeocodeResult }> } };
      const stored = Object.values(body.detail.activities)[0]!.location as unknown as { lat: number; lng: number };
      expect(stored.lat).toBe(GEOCODED.lat);
      expect(stored.lng).toBe(GEOCODED.lng);
    });

    it("never reaches a geocoder for a batch with no location — so a missing key cannot break approval", async () => {
      const tripId = await seedTrip();
      const commands = await twoStopsOnDayOne(tripId);
      // No geocoder injected at all, matching POST's real call shape: if
      // anything tried to construct one, `getGeocoder()` would throw here.
      const res = await handleApplyProposalRequest(req(tripId, { commands }), tripId, undefined, silent);
      expect(res.status).toBe(200);
    });
  });

  // ---------------------------------------------------------------------------
  // ADR-042: an approved proposal that carries a playbook day BY REFERENCE
  // ---------------------------------------------------------------------------
  describe("an approved playbook insert", () => {
    it("commits an inserts-only approval as ONE batch, one history entry and one undo", async () => {
      const savedDayId = await publishedDay(AUTHOR_ID);
      const tripId = await seedTrip();
      const historyBefore = await getTripHistory(tripId);

      const res = await handleApplyProposalRequest(
        req(tripId, {
          proposalId: "p-insert",
          // No commands at all — the shape a turn whose only write call was
          // `insert_playbook_day` produces.
          commands: [],
          // The client's `name` is deliberately a LIE, so the assertions below
          // can only pass if the server read the row rather than the body.
          inserts: [{ savedDayId, name: "Whatever the client felt like saying" }],
        }),
        tripId,
        undefined,
        silent,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        detail: { days: { activityIds: string[] }[]; activities: Record<string, { title: string }> };
        history: { entries: { description: string }[]; canUndo: boolean };
        message: string;
      };

      // The day's stops really landed, on a new day at the end.
      expect(body.detail.days).toHaveLength(3);
      expect(body.detail.days[2]!.activityIds).toHaveLength(2);
      expect(Object.values(body.detail.activities).map((a) => a.title)).toEqual([
        "Fushimi Inari",
        "Nishiki Market",
      ]);
      // ONE entry added, not three — proof the AddDay and both AddActivitys
      // rode a single batchId (ADR-013).
      expect(body.history.entries).toHaveLength(historyBefore!.entries.length + 1);
      // The receipt names the row the server read, never the posted `name`.
      expect(body.message).toBe("Added “A day in Kyoto” from the library.");

      // ONE undo takes the whole insert back off the board. Two batches would
      // have needed two.
      const undone = await executeTripCommand({ type: "UndoLastChange", tripId }, ACTOR_ID);
      expect(undone.ok).toBe(true);
      if (!undone.ok) return;
      expect(undone.detail.days).toHaveLength(2);
      expect(Object.keys(undone.detail.activities)).toHaveLength(0);
    });

    it("commits the model's own commands and the inserted day in the SAME batch", async () => {
      const savedDayId = await publishedDay(AUTHOR_ID, "A day in Osaka");
      const tripId = await seedTrip();
      const historyBefore = await getTripHistory(tripId);

      const res = await handleApplyProposalRequest(
        req(tripId, {
          commands: await twoStopsOnDayOne(tripId),
          inserts: [{ savedDayId, name: "A day in Osaka" }],
        }),
        tripId,
        undefined,
        silent,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        detail: { days: unknown[]; activities: Record<string, unknown> };
        history: { entries: unknown[] };
        message: string;
      };
      expect(Object.keys(body.detail.activities)).toHaveLength(4);
      expect(body.history.entries).toHaveLength(historyBefore!.entries.length + 1);
      // Both halves of the receipt, in the order they were approved.
      expect(body.message).toBe(
        "Done — added “Sample: coffee stop” to day 1 and added “Sample: evening stroll” to day 1. " +
          "Added “A day in Osaka” from the library.",
      );
    });

    // **The property the whole design exists to protect** (SPEC §15): a build
    // that counts raw inserts produces a different and gameable order, so the
    // assistant's insert has to reach `saved_day_adds` through the same hook the
    // manual dialog does. Asserted against the LEDGER, not the counter — the
    // counter is what a build that got this wrong would still get right by
    // accident.
    it("writes the adds ledger row, in the same transaction as the batch", async () => {
      const savedDayId = await publishedDay(AUTHOR_ID);
      const tripId = await seedTrip();

      expect(
        (
          await handleApplyProposalRequest(
            req(tripId, { commands: [], inserts: [{ savedDayId }] }),
            tripId,
            undefined,
            silent,
          )
        ).status,
      ).toBe(200);

      const rows = await ledgerRows(savedDayId);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.tripId).toBe(tripId);
      expect(rows[0]!.addedBy).toBe(ACTOR_ID);
      expect(await expectCounterMatchesLedger(savedDayId)).toBe(1);
    });

    // `addCounts` is unchanged and uncopied, so its three negatives have to
    // hold through this door for the same reasons they hold through the manual
    // one. Each is proven against the ledger.
    describe("and the adds rule, unchanged, through this door", () => {
      it("does not count an insert into a trip with no dates", async () => {
        const savedDayId = await publishedDay(AUTHOR_ID);
        const tripId = await seedUndatedTrip();

        // Asserted, not discarded: the two assertions below hold just as well
        // for an insert that 404'd, so without this a regression that broke
        // inserting into an undated trip would pass a test whose whole claim is
        // that the insert SUCCEEDED and simply was not credited.
        expect(
          (
            await handleApplyProposalRequest(
              req(tripId, { commands: [], inserts: [{ savedDayId }] }),
              tripId,
              undefined,
              silent,
            )
          ).status,
        ).toBe(200);

        expect(await ledgerRows(savedDayId)).toHaveLength(0);
        expect(await expectCounterMatchesLedger(savedDayId)).toBe(0);
      });

      it("does not count the author inserting their OWN day into their own trip", async () => {
        // The approving actor is the day's author here, which is a completely
        // ordinary thing to do — and silently uncounted, never refused.
        const savedDayId = await publishedDay(ACTOR_ID, "My own template");
        const tripId = await seedTrip();

        expect(
          (
            await handleApplyProposalRequest(
              req(tripId, { commands: [], inserts: [{ savedDayId }] }),
              tripId,
              undefined,
              silent,
            )
          ).status,
        ).toBe(200);

        expect(await ledgerRows(savedDayId)).toHaveLength(0);
        expect(await expectCounterMatchesLedger(savedDayId)).toBe(0);
      });

      it("counts the same day approved twice into ONE trip only once", async () => {
        const savedDayId = await publishedDay(AUTHOR_ID);
        const tripId = await seedTrip();
        const body = { commands: [], inserts: [{ savedDayId }] };

        expect((await handleApplyProposalRequest(req(tripId, body), tripId, undefined, silent)).status).toBe(200);
        // The second approval still succeeds — putting a day into a trip twice
        // is reasonable, and the rule is about the NUMBER, not about refusing.
        expect((await handleApplyProposalRequest(req(tripId, body), tripId, undefined, silent)).status).toBe(200);

        expect(await ledgerRows(savedDayId)).toHaveLength(1);
        expect(await expectCounterMatchesLedger(savedDayId)).toBe(1);
      });
    });

    it("404s a saved day this actor may not read, and writes nothing at all", async () => {
      // Published, then withdrawn: from here it is indistinguishable from a day
      // that never existed, which is `readableSavedDay`'s whole point.
      const savedDayId = await publishedDay(AUTHOR_ID);
      const unpublished = await setSavedDayVisibility(savedDayId, AUTHOR_ID, "private");
      expect(unpublished).not.toBeNull();

      const tripId = await seedTrip();
      const before = await getTripDetail(tripId);

      const res = await handleApplyProposalRequest(
        req(tripId, { commands: [], inserts: [{ savedDayId }] }),
        tripId,
        undefined,
        silent,
      );
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "That saved day does not exist.", code: "not-found" });
      expect(JSON.stringify(await getTripDetail(tripId))).toBe(JSON.stringify(before));
      expect(await ledgerRows(savedDayId)).toHaveLength(0);
    });

    // A hallucinated id and a withdrawn day fail the same way, which is the
    // indistinguishability `savedDays.ts` records at length — the refusal must
    // not confirm whether the row exists.
    it("404s an id that never named a day, identically", async () => {
      const tripId = await seedTrip();
      const before = await getTripDetail(tripId);
      const res = await handleApplyProposalRequest(
        req(tripId, { commands: [], inserts: [{ savedDayId: randomUUID() }] }),
        tripId,
        undefined,
        silent,
      );
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "That saved day does not exist.", code: "not-found" });
      expect(JSON.stringify(await getTripDetail(tripId))).toBe(JSON.stringify(before));
    });

    it("refuses an approval carrying neither a command nor an insert", async () => {
      const tripId = await seedTrip();
      const res = await handleApplyProposalRequest(
        req(tripId, { commands: [], inserts: [] }),
        tripId,
        undefined,
        silent,
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "an approval must carry at least one change" });
    });
  });

  describe("refusals", () => {
    it.each([
      [{ commands: [] }, "an approval must carry at least one change"],
      [{ commands: [{ type: "NotACommand" }] }, "malformed change in this approval"],
      // zod's own message for a missing `commands` key — the shape of the
      // body was wrong before the rule about its contents could apply.
      [{}, "Required"],
    ])("400s %j", async (body, message) => {
      const tripId = await seedTrip();
      const res = await handleApplyProposalRequest(req(tripId, body), tripId, undefined, silent);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toContain(message);
    });

    it("400s malformed JSON", async () => {
      const tripId = await seedTrip();
      const res = await handleApplyProposalRequest(req(tripId, "{not json"), tripId, undefined, silent);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "malformed request" });
    });

    // A command the domain refuses aborts the whole batch atomically. Nothing
    // partial, and the trip is left exactly where it was.
    it("changes nothing when one command in the batch is stale", async () => {
      const tripId = await seedTrip();
      const commands = await twoStopsOnDayOne(tripId);
      const before = await getTripDetail(tripId);
      const res = await handleApplyProposalRequest(
        req(tripId, {
          commands: [
            ...commands,
            // A day that does not exist on this trip.
            { type: "AddActivity", tripId, activityId: randomUUID(), dayId: randomUUID(), title: "Nowhere" },
          ],
        }),
        tripId,
        undefined,
        silent,
      );
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(await getTripDetail(tripId))).toBe(JSON.stringify(before));
    });
  });
});
