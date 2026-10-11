import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { witness } from "@/test-support/witness";
import type { PathSegment } from "./grammar";
import { fit, PALETTE_ROWS, type PaletteHit, rankPalette, searchPalette } from "./match";
import type { PaletteCommand, PaletteSegment } from "./paletteRegistry";

const run = () => {};
let next = 0;
function path(text: string, more: Partial<Pick<PaletteCommand, "nearness" | "order">> = {}): PaletteCommand {
  const [action, type, target, destination] = text.split(" › ");
  const segment = (label: string | undefined): PaletteSegment | undefined => (label === undefined ? undefined : { label });
  next += 1;
  return { id: `c${next}`, action, type, target: segment(target), destination: segment(destination), run, ...more } as PaletteCommand;
}
const written = (hit: PaletteHit) => `${hit.steps.map((step) => step.label).join(" › ")}${hit.node.kind === "branch" ? " ›" : ""}`;
const ranked = (commands: readonly PaletteCommand[], query: string, at: readonly string[] = []) => rankPalette(commands, query, at).map(written);

const trip = [
  path("Go to › Trip › Tokyo"),
  path("Go to › Stop › Ramen"),
  path("Move › Stop › Ramen › Day 3"),
  path("Move › Stop › Ramen › Unscheduled"),
  path("Remove › Stop › Ramen"),
  path("Add › Stop"),
  path("Go to › Trip › Kyoto in spring"),
  path("Edit › Trip › Settings"),
];

// ADR-069 §3.
describe("rankPalette", () => {
  it("reads each word as a segment, in the path's order, skipping segments", () => {
    expect(ranked(trip, "go tokyo")).toEqual(["Go to › Trip › Tokyo"]);
    expect(ranked(trip, "move ramen 3")).toEqual(["Move › Stop › Ramen › Day 3"]);
    expect(ranked(trip, "tokyo go")).toEqual([]);
  });

  it("lets several words land on one segment", () => {
    expect(ranked(trip, "go kyoto spring")).toEqual(["Go to › Trip › Kyoto in spring"]);
  });

  // Mitchell, PR 398: "go" is what Go to offers, not every leaf under it.
  it("lists a node for its own last segment, branches as well as leaves, and not for its ancestors'", () => {
    expect(ranked(trip, "go")).toEqual(["Go to ›"]);
    expect(ranked(trip, "tokyo")).toEqual(["Go to › Trip › Tokyo"]);
    expect(ranked(trip, "trip")).toEqual(["Go to › Trip ›", "Edit › Trip ›"]);
    expect(ranked(trip, "ramen")).toEqual(["Go to › Stop › Ramen", "Move › Stop › Ramen ›", "Remove › Stop › Ramen"]);
  });

  it("answers to each segment's aliases", () => {
    expect(ranked(trip, "open tokyo")).toEqual(["Go to › Trip › Tokyo"]);
    expect(ranked(trip, "delete ramen")).toEqual(["Remove › Stop › Ramen"]);
    expect(ranked(trip, "new activity")).toEqual(["Add › Stop"]);
  });

  // "go" reads Go to's label and "view" its alias: two texts, so not Go to.
  it("lets the words on one segment read only one of its texts", () => {
    expect(ranked([path("Go to › View › Calendar")], "go view")).toEqual(["Go to › View ›"]);
  });

  // The existing tiers, per segment: "tin" starts a word of Old tin mine and
  // is only inside Destination, which was registered first.
  it("ranks a word's start above the same letters inside a segment", () => {
    expect(ranked([path("Go to › Trip › Destination"), path("Go to › Trip › Old tin mine")], "tin")).toEqual(["Go to › Trip › Old tin mine", "Go to › Trip › Destination"]);
  });

  // "go" is all of the stop Go, and only the start of Go to.
  it("ranks the node's own last segment's match first, above how deep it is", () => {
    expect(ranked([path("Go to › Trip › Tokyo"), path("Go to › Stop › Go")], "go")).toEqual(["Go to › Stop › Go", "Go to ›"]);
  });

  // Both are all of "trip"; the stop called Trip is focused, Edit › Trip's leaf is not.
  it("ranks a shallower node next, above nearness", () => {
    expect(ranked([path("Edit › Trip › Settings"), path("Go to › Stop › Trip", { nearness: "focused" })], "trip")).toEqual(["Edit › Trip ›", "Go to › Stop › Trip"]);
  });

  // Rome matches whole in both; "e" starts Edit and is only inside Remove.
  it("ranks the whole path's match next", () => {
    expect(ranked([path("Remove › Trip › Rome"), path("Edit › Trip › Rome")], "e rome")).toEqual(["Edit › Trip › Rome", "Remove › Trip › Rome"]);
  });

  // §5.2 and §5.3: equally good matches go nearest first, then in natural order.
  it("ranks equal matches by nearness, then natural order", () => {
    const days = [path("Go to › Day › Day 2", { order: 1 }), path("Go to › Day › Day 1", { order: 0 }), path("Go to › Day › Day 3", { order: 2, nearness: "focused" })];
    expect(ranked(days, "day")).toEqual(["Go to › Day ›", "Go to › Day › Day 3", "Go to › Day › Day 1", "Go to › Day › Day 2"]);
  });

  it("searches only under the branches opened, and not their segments", () => {
    expect(ranked(trip, "ramen", ["Move"])).toEqual(["Move › Stop › Ramen ›"]);
    expect(ranked(trip, "3", ["Move"])).toEqual(["Move › Stop › Ramen › Day 3"]);
    expect(ranked(trip, "move", ["Move"])).toEqual([]);
  });

  it("matches nothing when the letters are not there, or nothing is typed", () => {
    expect(ranked(trip, "zzz")).toEqual([]);
    expect(ranked(trip, "  ")).toEqual([]);
  });
});

// Every way the words can land, tried one by one: what `fit` computed before
// PR 398's review made it a table, kept here as the answer it must still give.
function exhaustive(words: readonly string[], segments: readonly PathSegment[], from: number, tier: (text: string, word: string) => number): [number, number] | null {
  const end = segments.length - 1;
  const tiers = words.map((word) => segments.map((segment, index) => (index < from ? [] : [segment.label, ...segment.aliases].map((text) => tier(text.toLowerCase(), word)))));
  let best: [number, number] | null = null;
  const walk = (word: number, segment: number, text: number, onLast: number, sum: number) => {
    if (word === words.length) {
      if (segment === end && (best === null || onLast < best[0] || (onLast === best[0] && sum < best[1]))) best = [onLast, sum];
      return;
    }
    for (let at = segment; at < segments.length; at += 1) {
      tiers[word]![at]!.forEach((t, which) => {
        if (t === Infinity || (at === segment && text !== -1 && which !== text)) return;
        walk(word + 1, at, which, at === end ? Math.min(onLast, t) : onLast, sum + t);
      });
    }
  };
  walk(0, from, -1, Infinity, 0);
  return best;
}

describe("fit", () => {
  // The tier of a one-segment, one-word path is fit's own: read it back
  // through fit, so the reference cannot drift from the tiers in use.
  const tierOf = (text: string, word: string) => fit([word], [{ role: "target", key: text, label: text, aliases: [] }], 0)?.[0] ?? Infinity;
  const segmentOf = (texts: string[], index: number): PathSegment => ({ role: "target", key: String(index), label: texts[0]!, aliases: texts.slice(1) });
  // A small alphabet, so words match segments often and in several ways.
  const word = fc.stringMatching(/^[abc]{1,2}$/);
  const text = fc.array(word, { minLength: 1, maxLength: 3 }).map((parts) => parts.join(" "));

  it("gives what trying every landing gives, for any words and path", () => {
    const w = witness("fit agrees with the exhaustive search on a match");
    fc.assert(
      fc.property(fc.array(fc.array(text, { minLength: 1, maxLength: 2 }), { minLength: 1, maxLength: 4 }), fc.array(word, { minLength: 1, maxLength: 5 }), fc.nat(), (texts, words, start) => {
        const segments = texts.map(segmentOf);
        const from = start % segments.length;
        const expected = exhaustive(words, segments, from, tierOf);
        expect(fit(words, segments, from)).toEqual(expected);
        if (expected !== null) w.tick();
      }),
      { numRuns: 500 },
    );
    // Measured 166-185 matches of 500 runs over ten runs; half the least.
    w.atLeast(83);
  });

  // PR 398 review (CodeRabbit): every word lands on every segment, so trying
  // each landing is C(words + segments - 1, segments - 1) walks, 22 million
  // here and several seconds; the table is words × segments, well under a
  // millisecond. A wall-clock budget, so far from both that neither flaps.
  it("stays bounded on a long query against a deep path", () => {
    const segments = Array.from({ length: 8 }, (_, i) => segmentOf(["a"], i));
    const started = performance.now();
    expect(fit(Array.from({ length: 34 }, () => "a"), segments, 0)).toEqual([0, 0]);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe("searchPalette", () => {
  const rows = (commands: readonly PaletteCommand[], query: string) => searchPalette(commands, query).flatMap((group) => group.hits.map((hit) => `${hit.child ? "  " : ""}${written(hit)}`));

  it(`shows the best ${PALETTE_ROWS}, grouped by action, the best match's group first`, () => {
    const many = [
      ...Array.from({ length: 6 }, (_, i) => path(`Move › Stop › Ramen ${i}`)),
      path("Go to › Stop › Ramen"),
      ...Array.from({ length: 4 }, (_, i) => path(`Remove › Stop › Ramen ${i}`)),
    ];
    const groups = searchPalette(many, "ramen");
    expect(groups.map((g) => [g.action, g.hits.length])).toEqual([
      ["Go to", 1],
      ["Move", 6],
      ["Remove", 1],
    ]);
  });

  // Go to ranks between two of its own paths: under their heading it would split it in two.
  it("keeps an action that matches out of its own action's heading", () => {
    const groups = searchPalette([path("Go to › View › Go"), path("Go to › Page › Gone")], "go");
    expect(groups.map((g) => g.hits.map(written))).toEqual([["Go to › View › Go", "Go to › Page › Gone"], ["Go to ›"]]);
  });

  // Mitchell, PR 398: "go" shows Go to's options without opening it.
  it("lists a top branch's children straight under it", () => {
    expect(rows(trip, "go")).toEqual(["Go to ›", "  Go to › Trip ›", "  Go to › Stop ›"]);
  });

  it("lists a child once, under its branch, and keeps within the rows", () => {
    const trips = Array.from({ length: 9 }, (_, i) => path(`Go to › Trip › Trip ${i}`));
    expect(rows([...trips, path("Edit › Trip › Settings")], "trip")).toEqual(["Go to › Trip ›", ...trips.slice(0, PALETTE_ROWS - 1).map((_, i) => `  Go to › Trip › Trip ${i}`)]);
  });
});
