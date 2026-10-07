import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { PersonColor } from "@tc/contracts";
import { defaultPersonColor, resolveTripColors } from "../src";
import { witness } from "./support/witness";

const PALETTE = PersonColor.options;

// The palette colour `steps` places after `color`, wrapping — what a shift
// lands on when every colour in between is free.
function after(color: PersonColor, steps = 1): PersonColor {
  return PALETTE[(PALETTE.indexOf(color) + steps) % PALETTE.length]!;
}

describe("resolveTripColors (M38 D3)", () => {
  it("keeps every stored choice when nobody clashes", () => {
    const out = resolveTripColors([
      { userId: "owner", color: "moss" },
      { userId: "b", color: "plum" },
      { userId: "c", color: "teal" },
    ]);
    expect([...out]).toEqual([
      ["owner", "moss"],
      ["b", "plum"],
      ["c", "teal"],
    ]);
  });

  it("shifts the later joiner of a two-way clash; the earlier one keeps theirs", () => {
    const out = resolveTripColors([
      { userId: "owner", color: "sky" },
      { userId: "late", color: "sky" },
    ]);
    expect(out.get("owner")).toBe("sky");
    expect(out.get("late")).toBe(after("sky"));
  });

  it("does not shift a clasher onto a colour a later member chose", () => {
    // `late` would land on plum (next after sky), but `last` stored plum and
    // never clashed with anyone — an explicit choice outranks a shift.
    const out = resolveTripColors([
      { userId: "owner", color: "sky" },
      { userId: "late", color: "sky" },
      { userId: "last", color: "plum" },
    ]);
    expect(out.get("owner")).toBe("sky");
    expect(out.get("last")).toBe("plum");
    expect(out.get("late")).toBe(after("sky", 2));
  });

  it("resolves a three-way clash in join order, wrapping past the end of the palette", () => {
    const last = PALETTE[PALETTE.length - 1]!;
    const out = resolveTripColors([
      { userId: "a", color: last },
      { userId: "b", color: last },
      { userId: "c", color: last },
    ]);
    expect(out.get("a")).toBe(last);
    expect(out.get("b")).toBe(PALETTE[0]);
    expect(out.get("c")).toBe(PALETTE[1]);
  });

  it("never mutates the stored choices it is given", () => {
    const members = Object.freeze([
      Object.freeze({ userId: "a", color: "moss" as const }),
      Object.freeze({ userId: "b", color: "moss" as const }),
      Object.freeze({ userId: "c", color: null }),
    ]);
    const before = structuredClone(members);
    resolveTripColors(members);
    expect(members).toEqual(before);
  });

  it("gives a member with no colour their userId's default, and the same one every call", () => {
    const out = resolveTripColors([{ userId: "nobody-chose", color: null }]);
    expect(out.get("nobody-chose")).toBe(defaultPersonColor("nobody-chose"));
    expect(resolveTripColors([{ userId: "nobody-chose", color: null }])).toEqual(out);
  });

  it("spreads userIds across the palette rather than collapsing onto one colour", () => {
    // A constant default would satisfy determinism and defeat the point.
    const seen = new Set(Array.from({ length: 64 }, (_, i) => defaultPersonColor(`user-${i}`)));
    expect(seen.size).toBe(PALETTE.length);
  });

  it("shifts a derived colour off an explicit choice, even one made by a later joiner", () => {
    const derived = defaultPersonColor("nobody-chose");
    const out = resolveTripColors([
      { userId: "nobody-chose", color: null },
      { userId: "chose", color: derived },
    ]);
    expect(out.get("chose")).toBe(derived);
    expect(out.get("nobody-chose")).toBe(after(derived));
  });

  it("a null member's colour does not depend on how unrelated members are ordered", () => {
    const w = witness("null colour order-independence");
    const subject = "subject-user";
    const derived = defaultPersonColor(subject);
    // Unrelated: explicit, distinct, and none of them on the subject's colour.
    const others = PALETTE.filter((c) => c !== derived);
    fc.assert(
      fc.property(
        fc.shuffledSubarray(others),
        fc.nat({ max: others.length }),
        (colors, at) => {
          const members = colors.map((color, i) => ({ userId: `other-${i}`, color }));
          members.splice(Math.min(at, members.length), 0, { userId: subject, color: null as never });
          const out = resolveTripColors(members);
          expect(out.get(subject)).toBe(derived);
          w.tick();
        },
      ),
      { numRuns: 200 },
    );
    w.atLeast(200);
  });

  it("allows clashes once the palette is exhausted, and stays deterministic", () => {
    const members = [
      ...PALETTE.map((color, i) => ({ userId: `m${i}`, color })),
      { userId: "ninth", color: "moss" as const },
      { userId: "tenth", color: null },
    ];
    const out = resolveTripColors(members);
    expect(out.size).toBe(members.length);
    // The first eight hold the whole palette, so each extra keeps what it
    // would have had: its stored choice, or its derived default.
    PALETTE.forEach((color, i) => expect(out.get(`m${i}`)).toBe(color));
    expect(out.get("ninth")).toBe("moss");
    expect(out.get("tenth")).toBe(defaultPersonColor("tenth"));
    expect(resolveTripColors(members)).toEqual(out);
  });

  it("assigns every member a palette colour, distinct while the palette lasts, for ANY trip", () => {
    const w = witness("resolveTripColors totality");
    const member = fc.record({
      userId: fc.string({ minLength: 1, maxLength: 12 }),
      color: fc.option(fc.constantFrom(...PALETTE), { nil: null }),
    });
    fc.assert(
      fc.property(fc.uniqueArray(member, { selector: (m) => m.userId, maxLength: 12 }), (members) => {
        const out = resolveTripColors(members);
        expect(out.size).toBe(members.length);
        const colors = members.map((m) => out.get(m.userId));
        colors.forEach((c) => expect(PALETTE).toContain(c));
        if (members.length <= PALETTE.length) expect(new Set(colors).size).toBe(members.length);
        // A stored choice survives for its first claimer.
        const firstClaim = new Map<PersonColor, string>();
        for (const m of members) if (m.color && !firstClaim.has(m.color)) firstClaim.set(m.color, m.userId);
        for (const [color, userId] of firstClaim) expect(out.get(userId)).toBe(color);
        expect(resolveTripColors(members)).toEqual(out);
        w.tick();
      }),
      { numRuns: 300 },
    );
    w.atLeast(300);
  });
});
