import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { isCommittedCost, stopHeadcount, stopTotal, type ActivityKind } from "../src";

// ADR-060: a stop's `cost` is the price for ONE person, and every total is
// `cost × headcount`. These are the three functions every reader of a cost
// calls, so a wrong answer here is a wrong total everywhere at once.

const YEN = (amountMinor: number) => ({ amountMinor, currency: "JPY" });

describe("stopHeadcount", () => {
  it("is the people picked, when somebody is", () => {
    expect(stopHeadcount({ participants: ["u1", "u2"] }, 5)).toBe(2);
  });

  it("is every member when nobody is picked — 'nobody picked' means everyone", () => {
    expect(stopHeadcount({ participants: [] }, 3)).toBe(3);
  });

  it("is never 0: a trip always has its owner, so a zero member count reads as one", () => {
    expect(stopHeadcount({ participants: [] }, 0)).toBe(1);
  });
});

describe("stopTotal", () => {
  it("multiplies the per-person price by the headcount", () => {
    expect(stopTotal({ cost: YEN(3000), participants: [] }, 3)).toBe(9000);
    expect(stopTotal({ cost: YEN(3000), participants: ["u1"] }, 3)).toBe(3000);
  });

  it("reads exactly as the price on a solo trip", () => {
    const w = { runs: 0 };
    fc.assert(
      fc.property(fc.nat({ max: 10_000_000 }), (amountMinor) => {
        w.runs += 1;
        expect(stopTotal({ cost: YEN(amountMinor), participants: [] }, 1)).toBe(amountMinor);
      }),
    );
    // Witness: no guard clause, so every generated case asserts.
    expect(w.runs).toBe(100);
  });

  it("is 0 for a stop with no cost", () => {
    expect(stopTotal({ cost: null, participants: ["u1", "u2"] }, 4)).toBe(0);
    expect(stopTotal({ participants: [] }, 4)).toBe(0);
  });
});

describe("isCommittedCost", () => {
  it("a pending stop's cost is an estimate; a planned or transit stop's is committed", () => {
    const answers: Record<ActivityKind, boolean> = { planned: true, transit: true, pending: false };
    for (const [kind, committed] of Object.entries(answers)) {
      expect(isCommittedCost(kind as ActivityKind), kind).toBe(committed);
    }
  });
});
