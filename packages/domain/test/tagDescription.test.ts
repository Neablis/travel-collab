import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ActivityTag, ActivityTagCategory, ActivityKind } from "@tc/contracts";
import {
  A_BIT_OF_EVERYTHING,
  MIN_DESCRIBED_STOPS,
  TAG_DESCRIPTION_COPY,
  describeByTags,
  describedTags,
  type DescribableStop,
} from "../src";
import { witness } from "./support/witness";

const stop = (...tags: ActivityTag[]): DescribableStop => ({ kind: "planned", tags });
const transit = (...tags: ActivityTag[]): DescribableStop => ({ kind: "transit", tags });

/** `n` stops carrying exactly `tags` each. */
const times = (n: number, ...tags: ActivityTag[]): DescribableStop[] => Array.from({ length: n }, () => stop(...tags));

/** `total` stops spread as evenly as it goes over `tags`, one tag each. */
function spread(total: number, tags: ActivityTag[]): DescribableStop[] {
  return Array.from({ length: total }, (_, i) => stop(tags[i % tags.length]!));
}

const text = (stops: DescribableStop[]) => describeByTags(stops)?.text ?? null;

describe("the copy beside the rule", () => {
  it("has an adjective and a noun for every category a description can name, and none for Lodging", () => {
    const named = ActivityTagCategory.options.filter((tag) => tag !== "lodging");
    expect(Object.keys(TAG_DESCRIPTION_COPY).sort()).toEqual([...named].sort());
    for (const tag of named) {
      const { adjective, noun } = TAG_DESCRIPTION_COPY[tag as keyof typeof TAG_DESCRIPTION_COPY];
      // Sentence case: the adjective stands alone, so it is capitalised; the
      // noun is the second half of a pair, so it is not.
      expect(adjective, tag).toMatch(/^[A-Z][a-z-]+$/);
      expect(noun, tag).toMatch(/^[a-z]+$/);
    }
  });
});

describe("describeByTags (ADR-070 §3)", () => {
  it(`says nothing below ${MIN_DESCRIBED_STOPS} counted stops, and counts only stops with a category`, () => {
    const uncounted = [
      stop(),
      stop("ticketed"),
      stop("lodging"),
      stop("lodging", "ticketed"),
      transit("outdoors"),
      transit("tour"),
    ];
    expect(describeByTags([...times(MIN_DESCRIBED_STOPS - 1, "outdoors"), ...uncounted])).toBeNull();
    expect(text([...times(MIN_DESCRIBED_STOPS, "outdoors"), ...uncounted])).toBe("Outdoorsy");
  });

  it("names Food at half the counted stops, not at 49%", () => {
    // The other half is spread over five categories, each under 25%, so only
    // Food can qualify.
    const others: ActivityTag[] = ["museum", "sight", "beach", "shopping", "show"];
    expect(describeByTags([...times(50, "meal"), ...spread(50, others)])).toEqual({ text: "Foodie", named: ["meal"] });
    expect(text([...times(49, "meal"), ...spread(51, others)])).toBe(A_BIT_OF_EVERYTHING);
  });

  it("names another category at a quarter of the non-Food stops, not at 24%", () => {
    const others: ActivityTag[] = ["museum", "sight", "beach", "shopping"];
    expect(text([...times(25, "outdoors"), ...spread(75, others)])).toBe("Outdoorsy");
    expect(text([...times(24, "outdoors"), ...spread(76, others)])).toBe(A_BIT_OF_EVERYTHING);
  });

  it("measures a non-Food category against the stops with a non-Food category, not every stop", () => {
    // Outdoors is 2 of 14 stops (14%) but 2 of the 8 non-Food ones (25%).
    const day = [...times(6, "meal"), ...times(2, "outdoors"), ...spread(6, ["museum", "sight", "beach", "shopping", "show", "tour"])];
    expect(text(day)).toBe("Outdoorsy");
  });

  // ADR-070 §3 as amended: one bar after four meals is 100% of the non-Food
  // stops, and still not what the day is about.
  it("names another category only when it is on at least two stops", () => {
    expect(text([...times(4, "meal"), stop("drinks")])).toBe("Foodie");
    expect(text([...times(4, "meal"), ...times(2, "drinks")])).toBe("Drinks & food");
  });

  it("names the top two by share, the larger first", () => {
    expect(describeByTags([...times(4, "beach"), ...times(3, "outdoors"), stop("museum")])).toEqual({
      text: "Beach & outdoors",
      named: ["beach", "outdoors"],
    });
    // A stop that is a meal and a drink counts for both.
    expect(text([...times(2, "meal", "drinks"), ...times(2, "meal"), stop("museum"), stop("sight")])).toBe("Food & drinks");
  });

  it("breaks a tie in contract order, so the same stops always read the same", () => {
    // Outdoors and Sight tie at 30% for second place; Outdoors is earlier in the contract.
    expect(text([...times(4, "beach"), ...times(3, "sight"), ...times(3, "outdoors")])).toBe("Beach & outdoors");
    // A tie at the top orders the pair the same way.
    expect(text([...times(2, "beach"), ...times(2, "outdoors")])).toBe("Outdoors & beach");
  });

  it("ignores Lodging and Ticketed on a stop that also has a category, and transit stops entirely", () => {
    const day = [...times(4, "outdoors", "lodging", "ticketed"), ...times(8, "ticketed"), ...times(8, "lodging")];
    expect(text(day)).toBe("Outdoorsy");
    expect(text([...times(4, "outdoors"), ...Array.from({ length: 10 }, () => transit("tour"))])).toBe("Outdoorsy");
  });

  it("is a bit of everything when no category qualifies", () => {
    expect(describeByTags(spread(10, ["museum", "sight", "beach", "shopping", "show"]))).toEqual({
      text: A_BIT_OF_EVERYTHING,
      named: [],
    });
  });

  // The rule's two exclusions and its indifference to order, over any stops:
  // nothing that is not a counted category may move the answer.
  it("never changes for Ticketed, Lodging, transit stops or the stops' order", () => {
    const w = witness("tag description invariance");
    const anyStop = fc.record({
      kind: fc.constantFrom(...ActivityKind.options),
      tags: fc.subarray([...ActivityTag.options]),
    });
    fc.assert(
      fc.property(fc.array(anyStop, { maxLength: 16 }), fc.array(anyStop, { maxLength: 6 }), (stops, noise) => {
        const before = describeByTags(stops);
        const padded = [
          ...stops.map((s) => (s.kind === "transit" ? s : { ...s, tags: [...s.tags, "ticketed" as const] })),
          ...noise.map((s) => (s.kind === "transit" ? s : { ...s, tags: s.tags.filter((t) => t === "ticketed" || t === "lodging") })),
        ].reverse();
        if (before !== null) w.tick();
        expect(describeByTags(padded)).toEqual(before);
      }),
    );
    w.atLeast(17); // observed 35-47 over 8 runs: most random stop lists are under the minimum
  });
});

describe("describedTags", () => {
  it("lists every counted category, most stops first, ties in contract order", () => {
    const day = [...times(2, "sight"), stop("beach", "lodging"), stop("museum", "ticketed"), stop("lodging"), stop("ticketed"), transit("tour")];
    expect(describedTags(day)).toEqual(["sight", "museum", "beach"]);
  });
});
