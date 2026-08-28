// The central claim of the 2026-07-26 AI id-resolver rework (ADR-015, and the
// M7 post-gate retro) is an *equivalence*: `resolveBatch` dry-runs the real
// domain, so any command that survives resolution will be accepted by
// `executeTripCommandBatch`'s decide loop. That matters because the batch is
// atomic — one command rejected at execution rolls back the entire AI request,
// including every valid change alongside it.
//
// Until now that claim rested on example tests. An equivalence between two code
// paths is exactly the shape a property test is for: generate adversarial
// intent sequences and assert the two agree, rather than hand-picking the cases
// we already thought of.
//
// It found nothing — 1,000 generated batches per run, ~890 of them non-empty,
// zero divergence (and an earlier throwaway probe over 3,000 hand-seeded cases
// agreed). That is a useful result rather than a wasted test: it says the seven
// live AI failures in M7 were all in the layers *above* this one — context
// envelope, step budget, prompt — and that resolution itself does not need
// rewriting.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { TripDetail } from "@tc/contracts";
import { decideTripCommand, evolveTrip, hydrate, tripDetailFromState } from "@tc/domain";
import { resolveBatch, type RawToolIntent } from "./batchResolver";
import { witness } from "@/test-support/witness";

const TRIP = "7d9a1f8e-0000-4000-8000-00000000000a";
const uuid = (n: number) => `7d9a1f8e-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ACTOR = "u1";
const TITLES = ["Colosseum", "Lunch", "Museum"];

function startingDetail(nDays: number): TripDetail {
  let state: Parameters<typeof tripDetailFromState>[0] | null = null;
  const apply = (command: Parameters<typeof decideTripCommand>[1]): void => {
    const decision = decideTripCommand(state, command, { actorId: ACTOR });
    if (!decision.ok) throw new Error(`setup rejected ${command.type}: ${decision.rejection.code}`);
    for (const event of decision.events) state = evolveTrip(state, event);
  };
  apply({ type: "CreateTrip", tripId: TRIP, name: "Property trip" , forkedFrom: null});
  for (let i = 0; i < nDays; i++) apply({ type: "AddDay", tripId: TRIP, dayId: uuid(100 + i) });
  TITLES.forEach((title, i) =>
    apply({
      type: "AddActivity",
      tripId: TRIP,
      activityId: uuid(200 + i),
      dayId: nDays > 0 ? uuid(100) : undefined,
      title,
    }),
  );
  return tripDetailFromState(state!, "2026-07-28T00:00:00.000Z");
}

/**
 * Mirrors `executeTripCommandBatch`'s decide loop exactly (commands.ts step 4),
 * minus the database: decide each command in order against the evolving state,
 * skip a `no-op`, abort on any real rejection.
 */
function executorWouldAccept(detail: TripDetail, commands: readonly unknown[]) {
  let state = hydrate(detail);
  for (let i = 0; i < commands.length; i++) {
    const decision = decideTripCommand(state, commands[i] as never, { actorId: ACTOR });
    if (!decision.ok) {
      if (decision.rejection.code === "no-op") continue;
      return { aborted: true as const, at: i, code: decision.rejection.code };
    }
    for (const event of decision.events) state = evolveTrip(state, event);
  }
  return { aborted: false as const };
}

// Refs deliberately include ones that are stale, ambiguous, out of range, and
// simply wrong — the malformed shapes a real model actually emits.
const dayRef = fc.constantFrom("day 1", "day 2", "day 3", "day 9", "backlog", null);
const activityRef = fc.constantFrom(...TITLES, "colosseum", "Nonexistent", "");

const intentArb: fc.Arbitrary<RawToolIntent> = fc.oneof(
  fc.record({ type: fc.constant("AddDay" as const), args: fc.constant({}) }),
  fc.record({
    type: fc.constant("AddActivity" as const),
    args: fc.record({ title: fc.constantFrom("New stop", "Dinner", ...TITLES), dayRef }),
  }),
  fc.record({
    type: fc.constant("MoveActivity" as const),
    args: fc.record({ activityRef, dayRef, position: fc.integer({ min: 0, max: 3 }) }),
  }),
  fc.record({ type: fc.constant("RemoveActivity" as const), args: fc.record({ activityRef }) }),
  fc.record({ type: fc.constant("RemoveDay" as const), args: fc.record({ dayRef }) }),
  fc.record({
    type: fc.constant("UpdateActivity" as const),
    args: fc.record({ activityRef, title: fc.constantFrom("Renamed", "Lunch") }),
  }),
  fc.record({
    type: fc.constant("SetTripCurrency" as const),
    args: fc.record({ currency: fc.constantFrom("USD", "EUR") }),
  }),
  fc.record({
    type: fc.constant("SetTripBudget" as const),
    args: fc.record({ budget: fc.option(fc.constant({ amountMinor: 50_000, currency: "USD" }), { nil: null }) }),
  }),
);

describe("resolveBatch — the dry-run agrees with the executor", () => {
  it("no command that survives resolution is later rejected by the real decide loop", () => {
    const w = witness("resolver/executor equivalence");
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 3 }),
        fc.array(intentArb, { minLength: 1, maxLength: 8 }),
        (nDays, intents) => {
          const detail = startingDetail(nDays);
          let minted = 500;
          const { commands } = resolveBatch(intents, detail, {
            tripId: TRIP,
            actorId: ACTOR,
            mintId: () => uuid(minted++),
          });
          if (commands.length === 0) return; // everything was dropped at resolve time — nothing to execute

          w.tick();
          const outcome = executorWouldAccept(detail, commands);
          expect(
            outcome.aborted,
            outcome.aborted
              ? `executor aborted at command #${outcome.at} with "${outcome.code}" — resolveBatch let through a ` +
                `command the domain rejects, which rolls back the whole atomic batch. ` +
                `Batch: ${JSON.stringify(commands)}`
              : "",
          ).toBe(false);
        },
      ),
      { numRuns: 1000 },
    );
    w.atLeast(400); // measured 887-907 of 1000; the rest resolve to an empty batch
  });

  it("every surviving command targets the trip it was resolved against", () => {
    const w = witness("tripId scoping");
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 3 }),
        fc.array(intentArb, { minLength: 1, maxLength: 8 }),
        (nDays, intents) => {
          const detail = startingDetail(nDays);
          let minted = 500;
          const { commands } = resolveBatch(intents, detail, {
            tripId: TRIP,
            actorId: ACTOR,
            mintId: () => uuid(minted++),
          });
          for (const command of commands) {
            w.tick();
            expect((command as { tripId: string }).tripId).toBe(TRIP);
          }
        },
      ),
      { numRuns: 300 },
    );
    w.atLeast(300); // measured 688-725
  });
});
