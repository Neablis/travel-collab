import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { SuggestionChange } from "@tc/contracts";
import { witness } from "@/test-support/witness";
import { acceptAllOrder } from "./acceptAll";

// "Accept all" (W77; Mitchell's preview comment, 2026-10-04): every pending
// change that still applies, parents before the changes built on them.

const change = (id: string, dependsOn: string[] = []): SuggestionChange => ({
  id,
  suggestionId: "s",
  tripId: "t",
  authorId: "dev-sam",
  note: null,
  createdAt: "2026-10-04T10:00:00.000Z",
  commands: [],
  description: id,
  status: "pending",
  dependsOn,
  resolvedBy: null,
  resolvedAt: null,
});
const ids = (changes: SuggestionChange[]) => changes.map((c) => c.id);

describe("acceptAllOrder", () => {
  it("puts a parent before the change built on it, whatever order they are listed in", () => {
    expect(ids(acceptAllOrder([change("c", ["b"]), change("b", ["a"]), change("a")], new Set()))).toEqual(["a", "b", "c"]);
  });

  it("skips a change that no longer applies, and every change built on it", () => {
    expect(ids(acceptAllOrder([change("a"), change("b", ["a"]), change("c")], new Set(["a"])))).toEqual(["c"]);
  });

  it("takes a change whose parent is no longer pending as it is", () => {
    expect(ids(acceptAllOrder([change("b", ["accepted-already"])], new Set()))).toEqual(["b"]);
  });

  // For ALL drafts: dependencies only ever point at an earlier change of the
  // same suggestion (server/suggestions/dependencies.ts), so a random DAG over
  // positions, listed shuffled, is every shape the list can take.
  it("for any list, orders parents first and leaves out exactly what cannot be accepted", () => {
    const w = witness("accept-all order");
    const list = fc
      .integer({ min: 1, max: 8 })
      .chain((n) =>
        fc.tuple(
          fc.tuple(...Array.from({ length: n }, (_, i) => fc.subarray(Array.from({ length: i }, (_, j) => `c${j}`)))),
          fc.subarray(Array.from({ length: n }, (_, i) => `c${i}`)),
          fc.shuffledSubarray(Array.from({ length: n }, (_, i) => i), { minLength: n }),
        ),
      );
    fc.assert(
      fc.property(list, ([deps, stale, shuffle]) => {
        const all = deps.map((d, i) => change(`c${i}`, d));
        const order = acceptAllOrder(
          shuffle.map((i) => all[i]!),
          new Set(stale),
        );
        const at = new Map(order.map((c, i) => [c.id, i]));
        const blocked = (c: SuggestionChange): boolean => stale.includes(c.id) || c.dependsOn.some((p) => blocked(all[Number(p.slice(1))]!));
        for (const c of all) {
          expect(at.has(c.id)).toBe(!blocked(c));
          for (const p of c.dependsOn) if (at.has(c.id)) expect(at.get(p)!).toBeLessThan(at.get(c.id)!);
        }
        if (order.some((c) => c.dependsOn.length > 0)) w.tick();
      }),
    );
    w.atLeast(11); // observed 22-40 per 100 runs, over 15 runs
  });
});
