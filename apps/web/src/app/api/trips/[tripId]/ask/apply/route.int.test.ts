import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BatchableCommand } from "@tc/contracts";
import { executeTripCommand } from "@/server/commands";
import { getTripDetail } from "@/server/projections";
import { getTripHistory } from "@/server/history";
import { db } from "@/server/db/client";
import { rateLimitCounters, tripMemberships } from "@/server/db/schema";
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
