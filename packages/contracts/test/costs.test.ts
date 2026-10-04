import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { balances, isCommittedCost, stopHeadcount, stopPeople, stopTotal, type ActivityKind } from "../src";

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

  // `participants` is an unconstrained string[] and the domain stores what it
  // is given, so a duplicate id is valid input. Counting the array would charge
  // that person twice; a schema-level refusal would reject events already in
  // the log.
  it("counts a person once however many times they are picked", () => {
    expect(stopHeadcount({ participants: ["u1", "u1", "u2"] }, 5)).toBe(2);
    expect(stopTotal({ cost: YEN(3000), participants: ["u1", "u1"] }, 5)).toBe(3000);
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

// ADR-060 decision 6: every person in a stop owes `cost` to its `bookedBy`, and
// a stop nobody booked is owed to the trip ("not paid yet").
describe("stopPeople", () => {
  it("is who is picked, or every member when nobody is", () => {
    expect(stopPeople({ participants: ["u2"] }, ["u1", "u2", "u3"])).toEqual(["u2"]);
    expect(stopPeople({ participants: [] }, ["u1", "u2"])).toEqual(["u1", "u2"]);
  });

  it("names a repeated participant once, as stopHeadcount counts them", () => {
    expect(stopPeople({ participants: ["u2", "u2"] }, ["u1", "u2"])).toEqual(["u2"]);
  });
});

describe("balances", () => {
  const MEMBERS = ["ana", "ben", "cy"];
  const stop = (amountMinor: number | null, participants: string[], bookedBy: string | null) => ({
    cost: amountMinor === null ? null : YEN(amountMinor),
    participants,
    bookedBy,
  });
  const byId = (result: ReturnType<typeof balances>) =>
    Object.fromEntries(result.perMember.map(({ userId, ...rest }) => [userId, rest]));

  it("charges everyone their share and credits the payer with the whole bill, so their own share cancels", () => {
    // A ¥3,000-a-head dinner for all three, booked by Ana: she paid ¥9,000 and
    // is in for ¥3,000 of it, so the other two owe her ¥6,000 between them.
    const result = balances([stop(3000, [], "ana")], MEMBERS);
    expect(byId(result)).toEqual({
      ana: { share: 3000, paid: 9000, net: 6000, former: false },
      ben: { share: 3000, paid: 0, net: -3000, former: false },
      cy: { share: 3000, paid: 0, net: -3000, former: false },
    });
    expect(result.unpaid).toBe(0);
  });

  it("charges only the people picked, and the payer need not be one of them", () => {
    // Ben books a ¥5,000 ticket for Cy alone: Cy owes Ben all of it.
    const result = balances([stop(5000, ["cy"], "ben")], MEMBERS);
    expect(byId(result)).toEqual({
      ana: { share: 0, paid: 0, net: 0, former: false },
      ben: { share: 0, paid: 5000, net: 5000, former: false },
      cy: { share: 5000, paid: 0, net: -5000, former: false },
    });
  });

  it("puts a stop nobody booked on the 'not paid yet' line: its people owe the trip, and nobody has paid", () => {
    const result = balances([stop(2000, ["ana", "ben"], null)], MEMBERS);
    expect(result.unpaid).toBe(4000);
    expect(byId(result).ana).toEqual({ share: 2000, paid: 0, net: -2000, former: false });
    expect(byId(result).cy).toEqual({ share: 0, paid: 0, net: 0, former: false });
  });

  it("lists every member in member order, and skips a stop with no price", () => {
    const result = balances([stop(null, ["ana"], "ben"), stop(0, [], "cy")], MEMBERS);
    expect(result.perMember.map((m) => m.userId)).toEqual(MEMBERS);
    expect(result.perMember.every((m) => m.share === 0 && m.paid === 0)).toBe(true);
  });

  it("still counts someone who has left the trip, after the members and marked as former", () => {
    // `ActivityView` keeps a `bookedBy` or a participant who is no longer a
    // member (detail.ts: "must still READ"). Their money did not leave with
    // them, so dropping them would make the balances stop adding up.
    const result = balances([stop(1000, ["gone", "ana"], "left")], MEMBERS);
    expect(result.perMember.map((m) => [m.userId, m.former])).toEqual([
      ["ana", false], ["ben", false], ["cy", false], ["gone", true], ["left", true],
    ]);
    expect(byId(result).left).toEqual({ share: 0, paid: 2000, net: 2000, former: true });
  });

  it("charges each person exactly what stopTotal says the stop costs, for every trip", () => {
    // The one rule (`stopTotal`) and the split must agree: the shares of a
    // stop's people add up to that stop's total.
    let runs = 0;
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.string({ minLength: 1, maxLength: 3 }), { minLength: 1, maxLength: 5 }),
        fc.nat({ max: 100_000 }),
        fc.boolean(),
        (members, amountMinor, pickSome) => {
          const participants = pickSome ? members.slice(0, 1) : [];
          const activity = { cost: YEN(amountMinor), participants, bookedBy: null };
          const shares = balances([activity], members).perMember.reduce((sum, m) => sum + m.share, 0);
          runs += 1;
          expect(shares).toBe(stopTotal(activity, members.length));
        },
      ),
    );
    // Witness: no guard clause, so every generated case asserts.
    expect(runs).toBe(100);
  });

  it("nets to minus what is not paid yet, for every trip — the money balances", () => {
    // **The invariant.** Every minor unit owed is owed either to a person (and
    // then that person's `paid` holds it) or to the trip (`unpaid`). So what
    // everybody paid minus what everybody owes is exactly what nobody has paid:
    // Σ net = −unpaid. Former members are in `perMember`, which is why this
    // holds when the ids wander outside `memberIds`.
    const ids = ["a", "b", "c", "d", "gone"];
    const arbStop = fc.record({
      cost: fc.option(fc.nat({ max: 50_000 }).map(YEN), { nil: null }),
      // Repeats included: `participants` is not constrained unique, and a
      // repeated id is one person (`stopHeadcount`), so it must owe once.
      participants: fc.array(fc.constantFrom(...ids), { maxLength: 6 }),
      bookedBy: fc.option(fc.constantFrom(...ids), { nil: null }),
    });
    let withMoney = 0;
    fc.assert(
      fc.property(fc.array(arbStop, { maxLength: 8 }), fc.subarray(ids.slice(0, 4)), (stops, members) => {
        const result = balances(stops, members);
        const net = result.perMember.reduce((sum, m) => sum + m.net, 0);
        // Ticks only when money moved: with nothing priced, 0 === −0 is true
        // of any implementation.
        if (result.perMember.some((m) => m.share > 0)) withMoney += 1;
        expect(net + result.unpaid).toBe(0);
        for (const m of result.perMember) expect(m.net).toBe(m.paid - m.share);
      }),
    );
    expect(withMoney).toBeGreaterThanOrEqual(39); // observed 78-90 of 100 carry money
  });
});
