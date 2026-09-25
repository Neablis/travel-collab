import { describe, expect, it, vi } from "vitest";
import type { BatchableCommand } from "@tc/contracts";
import type { PendingUnit } from "./optimistic";
import { unloadFlush } from "./unloadFlush";

const TRIP = "00000000-0000-4000-8000-000000000000";

function unit(id: string, nameLength = 10): PendingUnit {
  const command = { type: "SetTripName", tripId: TRIP, name: "n".repeat(nameLength) } as BatchableCommand;
  return { id, commands: [command], predictedDetail: null, description: id };
}

const bodySize = (commands: BatchableCommand[]) => new TextEncoder().encode(JSON.stringify({ commands })).length;

describe("unloadFlush (KI-5)", () => {
  it("sends nothing for an empty queue", () => {
    expect(unloadFlush([], { unloading: true })).toBeNull();
  });

  it("sends every unit, in order, as one keepalive batch when it fits", () => {
    const units = [unit("a"), unit("b"), unit("c")];
    const flush = unloadFlush(units, { unloading: true });
    expect(flush?.units.map((u) => u.id)).toEqual(["a", "b", "c"]);
    expect(flush?.commands).toEqual(units.flatMap((u) => u.commands));
    expect(flush?.keepalive).toBe(true);
  });

  it("on unload, sends the longest prefix that fits and never skips a unit to fit a later one", () => {
    // b is too big to fit after a; c is small and would fit on its own.
    const units = [unit("a", 100), unit("b", 1000), unit("c", 10)];
    const budget = bodySize(units[0]!.commands) + 200;
    const flush = unloadFlush(units, { unloading: true, budget });
    expect(flush?.units.map((u) => u.id)).toEqual(["a"]);
    expect(bodySize(flush!.commands)).toBeLessThanOrEqual(budget);
  });

  it("on unload, sends nothing when even the first unit is over the limit", () => {
    expect(unloadFlush([unit("a", 1000)], { unloading: true, budget: 100 })).toBeNull();
  });

  it("takes a unit whose body lands exactly on the budget, and not one byte over", () => {
    const units = [unit("a", 40), unit("b", 40), unit("c", 40)];
    const two = bodySize([...units[0]!.commands, ...units[1]!.commands]);
    expect(unloadFlush(units, { unloading: true, budget: two })?.units.map((u) => u.id)).toEqual(["a", "b"]);
    expect(unloadFlush(units, { unloading: true, budget: two - 1 })?.units.map((u) => u.id)).toEqual(["a"]);
  });

  it("sizes the prefix in one pass — each unit is encoded once, not the whole batch again per unit", () => {
    // Runs synchronously inside `pagehide`. Re-encoding the growing batch for
    // every unit is quadratic in the queue: ~150 units here would encode ~70x
    // the queue's own size instead of about 2x.
    const units = Array.from({ length: 200 }, (_, i) => unit(`u${i}`, 30));
    const whole = bodySize(units.flatMap((u) => u.commands));
    const encode = vi.spyOn(TextEncoder.prototype, "encode");
    try {
      const flush = unloadFlush(units, { unloading: true, budget: Math.floor(whole * 0.75) });
      expect(flush?.units.length).toBeGreaterThan(100);
      const encoded = encode.mock.calls.reduce((sum, [input]) => sum + (input?.length ?? 0), 0);
      expect(encoded).toBeLessThanOrEqual(3 * whole);
    } finally {
      encode.mockRestore();
    }
  });

  it("when the page is staying, sends everything without keepalive rather than dropping any", () => {
    const units = [unit("a", 1000), unit("b", 1000)];
    const flush = unloadFlush(units, { unloading: false, budget: 100 });
    expect(flush?.units.map((u) => u.id)).toEqual(["a", "b"]);
    expect(flush?.keepalive).toBe(false);
  });
});
