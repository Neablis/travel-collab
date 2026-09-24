import { describe, expect, it, vi } from "vitest";
import type { WidgetContext } from "./registry-types";
import { resolveRepeat } from "./repeat";
import { selectionTrip } from "./test-support/selectionTrip";

// `fieldAt` rebuilds the whole manifest by reflection on each call, so a
// sentence resolves each token's field once, not once per line (the PR #221
// self-review found 320 manifest builds for one render of a four-token stop
// sentence on an 80-stop trip). A file of its own: the spy replaces the
// module's export, and nothing else here should see it.
const spy = vi.hoisted(() => ({ calls: 0 }));
vi.mock("./fields", async (importOriginal) => {
  const real = await importOriginal<typeof import("./fields")>();
  return {
    ...real,
    fieldAt: (...args: Parameters<typeof real.fieldAt>) => {
      spy.calls += 1;
      return real.fieldAt(...args);
    },
  };
});

const { sentenceLines } = await import("./sentence");

describe("sentenceLines", () => {
  it("resolves each token's field once, however many items it prints", () => {
    const { trip, globals } = selectionTrip();
    const ctx: WidgetContext = { trip, globals, page: { tripId: trip.tripId }, user: null, today: null };
    const outcome = resolveRepeat(ctx, "stop.rows", {});
    if (outcome.status !== "ok") throw new Error(outcome.status);
    expect(outcome.items.length, "the witness: several stops").toBeGreaterThan(3);
    spy.calls = 0;
    const lines = sentenceLines(ctx, outcome.over, outcome.items, "{title} costs {cost}");
    expect(lines).toHaveLength(outcome.items.length);
    expect(spy.calls).toBe(2);
  });
});
