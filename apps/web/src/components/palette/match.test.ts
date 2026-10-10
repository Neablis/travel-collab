import { describe, expect, it } from "vitest";
import { pathText } from "./grammar";
import { PALETTE_ROWS, rankLeaves, searchPalette } from "./match";
import type { PaletteCommand, PaletteSegment } from "./paletteRegistry";

const run = () => {};
let next = 0;
function path(text: string, more: Partial<Pick<PaletteCommand, "nearness" | "order">> = {}): PaletteCommand {
  const [action, type, target, destination] = text.split(" › ");
  const segment = (label: string | undefined): PaletteSegment | undefined => (label === undefined ? undefined : { label });
  next += 1;
  return { id: `c${next}`, action, type, target: segment(target), destination: segment(destination), run, ...more } as PaletteCommand;
}
const ranked = (commands: readonly PaletteCommand[], query: string, at: readonly string[] = []) => rankLeaves(commands, query, at).map((c) => pathText(c));

const trip = [
  path("Go to › Trip › Tokyo"),
  path("Go to › Stop › Ramen"),
  path("Move › Stop › Ramen › Day 3"),
  path("Move › Stop › Ramen › Unscheduled"),
  path("Remove › Stop › Ramen"),
  path("Add › Stop"),
  path("Go to › Trip › Kyoto in spring"),
];

// ADR-069 §3.
describe("rankLeaves", () => {
  it("reads each word as a segment, in the path's order, skipping segments", () => {
    expect(ranked(trip, "go tokyo")).toEqual(["Go to › Trip › Tokyo"]);
    expect(ranked(trip, "move ramen 3")).toEqual(["Move › Stop › Ramen › Day 3"]);
    expect(ranked(trip, "tokyo go")).toEqual([]);
  });

  it("lets several words land on one segment", () => {
    expect(ranked(trip, "go kyoto spring")).toEqual(["Go to › Trip › Kyoto in spring"]);
  });

  it("finds every path with a segment that matches a lone word", () => {
    expect(ranked(trip, "ramen")).toEqual(["Go to › Stop › Ramen", "Move › Stop › Ramen › Day 3", "Move › Stop › Ramen › Unscheduled", "Remove › Stop › Ramen"]);
  });

  it("answers to each segment's aliases", () => {
    expect(ranked(trip, "open tokyo")).toEqual(["Go to › Trip › Tokyo"]);
    expect(ranked(trip, "delete ramen")).toEqual(["Remove › Stop › Ramen"]);
    expect(ranked(trip, "new activity")).toEqual(["Add › Stop"]);
  });

  // The existing tiers, per segment: "tin" starts a word of Old tin mine and
  // is only inside Destination, which was registered first.
  it("ranks a word's start above the same letters inside a segment", () => {
    expect(ranked([path("Go to › Trip › Destination"), path("Go to › Trip › Old tin mine")], "tin")).toEqual(["Go to › Trip › Old tin mine", "Go to › Trip › Destination"]);
  });

  // ADR-069 §5.1: "stop" says Stopover's Target, and only Pasta's Type.
  it("ranks the Target's match above the rest of the path's", () => {
    expect(ranked([path("Edit › Stop › Pasta"), path("Go to › Trip › Stopover in Lima")], "stop")).toEqual(["Go to › Trip › Stopover in Lima", "Edit › Stop › Pasta"]);
  });

  // Rome matches whole in both; "e" starts Edit and is only inside Remove.
  it("ranks the whole path's match next", () => {
    expect(ranked([path("Remove › Trip › Rome"), path("Edit › Trip › Rome")], "e rome")).toEqual(["Edit › Trip › Rome", "Remove › Trip › Rome"]);
  });

  // §5.2 and §5.3: equally good matches go nearest first, then in natural order.
  it("ranks equal matches by nearness, then natural order", () => {
    const days = [path("Go to › Day › Day 2", { order: 1 }), path("Go to › Day › Day 1", { order: 0 }), path("Go to › Day › Day 3", { order: 2, nearness: "focused" })];
    expect(ranked(days, "day")).toEqual(["Go to › Day › Day 3", "Go to › Day › Day 1", "Go to › Day › Day 2"]);
  });

  it("searches only under the branches opened, and not their segments", () => {
    expect(ranked(trip, "ramen", ["Move"])).toEqual(["Move › Stop › Ramen › Day 3", "Move › Stop › Ramen › Unscheduled"]);
    expect(ranked(trip, "move", ["Move"])).toEqual([]);
  });

  it("matches nothing when the letters are not there, or nothing is typed", () => {
    expect(ranked(trip, "zzz")).toEqual([]);
    expect(ranked(trip, "  ")).toEqual([]);
  });
});

describe("searchPalette", () => {
  it(`shows the best ${PALETTE_ROWS}, grouped by action, the best match's group first`, () => {
    const many = [
      ...Array.from({ length: 6 }, (_, i) => path(`Move › Stop › Ramen ${i}`)),
      path("Go to › Stop › Ramen"),
      ...Array.from({ length: 4 }, (_, i) => path(`Remove › Stop › Ramen ${i}`)),
    ];
    const groups = searchPalette(many, "ramen");
    expect(groups.map((g) => [g.action, g.commands.length])).toEqual([
      ["Go to", 1],
      ["Move", 6],
      ["Remove", 1],
    ]);
  });
});
