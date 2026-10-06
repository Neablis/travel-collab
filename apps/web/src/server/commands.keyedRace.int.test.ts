import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

// A competing request committed at an exact point inside another one's
// transaction, by wrapping the receipts read that both make (ADR-066). `inject`
// runs once, around the next `appliedKeys` call: "before" commits it ahead of
// that read, "after" between that read and the rest of the transaction.
let inject: { when: "before" | "after"; run: () => Promise<unknown> } | null = null;

vi.mock("./commandReceipts", async (orig) => {
  const actual = await orig<typeof import("./commandReceipts")>();
  return {
    ...actual,
    appliedKeys: async (...args: Parameters<typeof actual.appliedKeys>) => {
      const once = inject;
      inject = null;
      if (once?.when === "before") await once.run();
      const result = await actual.appliedKeys(...args);
      if (once?.when === "after") await once.run();
      return result;
    },
  };
});

const { executeTripCommand, executeTripCommandBatch } = await import("./commands");

const ACTOR = "user-1";
const addDay = (tripId: string, dayId: string) => ({ type: "AddDay", tripId, dayId }) as const;
const flush = (tripId: string, units: { key: string; dayId: string }[]) =>
  executeTripCommandBatch(
    units.map((u) => addDay(tripId, u.dayId)),
    ACTOR,
    undefined,
    { units: units.map((u) => ({ key: u.key, size: 1 })) },
  );

async function newTrip() {
  const tripId = randomUUID();
  await executeTripCommand({ type: "CreateTrip", tripId, name: "Keyed race" }, ACTOR);
  return tripId;
}

beforeEach(() => {
  inject = null;
});

describe("a unit landing through another request mid-transaction (ADR-066, PR #345 review)", () => {
  it("a head answered from its receipt carries the trip with its own edit in it", async () => {
    // The flush carrying the head commits just as the head starts. Its answer
    // is "applied", and must not be a trip read before the flush landed.
    const tripId = await newTrip();
    const head = { key: randomUUID(), dayId: randomUUID() };
    inject = { when: "before", run: () => flush(tripId, [head]) };
    const result = await executeTripCommand(addDay(tripId, head.dayId), ACTOR, { idempotencyKey: head.key });
    expect(result.ok ? result.detail.days.map((d) => d.dayId) : result.error).toEqual([head.dayId]);
  });

  it("a keyed batch answered from its receipts carries the trip with those units in it", async () => {
    const tripId = await newTrip();
    const unit = { key: randomUUID(), dayId: randomUUID() };
    inject = { when: "before", run: () => flush(tripId, [unit]) };
    const result = await flush(tripId, [unit]);
    expect(result.ok ? result.detail.days.map((d) => d.dayId) : result.error).toEqual([unit.dayId]);
  });

  it("a head the flush's events make a rejection is answered as applied, not refused", async () => {
    // Receipts read (no hit), THEN the flush commits, then the stream read sees
    // the head's own day: AddDay is decided on top of itself.
    const tripId = await newTrip();
    const head = { key: randomUUID(), dayId: randomUUID() };
    inject = { when: "after", run: () => flush(tripId, [head]) };
    const result = await executeTripCommand(addDay(tripId, head.dayId), ACTOR, { idempotencyKey: head.key });
    expect(result.ok ? "applied" : result.error).toBe("applied");
    if (result.ok) expect(result.detail.days.map((d) => d.dayId)).toEqual([head.dayId]);
  });
});
