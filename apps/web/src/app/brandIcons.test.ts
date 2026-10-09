import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ledgerColorToken } from "../../scripts/lib/ogTokens.mjs";

// The app icons are committed output of `scripts/generate-og-assets.mjs`, and
// for weeks after SPEC §28 replaced ◎ with two upright strokes they still drew
// ◎ in the pre-Ledger green — nothing compared them to BrandMark (Mitchell,
// 2026-10-09). `icon.svg` is the geometry every PNG is rasterised from in the
// same run, so holding it to the mark holds the PNGs too.
const app = join(process.cwd(), "src/app");
const svg = readFileSync(join(app, "icon.svg"), "utf8");
const css = readFileSync(join(app, "globals.css"), "utf8");

type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
};
const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
const rects: Rect[] = [...svg.matchAll(/<rect\b[^>]*>/g)].map(([tag]) => ({
  x: Number(attr(tag, "x") ?? 0),
  y: Number(attr(tag, "y") ?? 0),
  width: Number(attr(tag, "width")),
  height: Number(attr(tag, "height")),
  fill: attr(tag, "fill") ?? "",
}));
// The first rect is the tile — the generator writes it first — and the rest are strokes.
const tile = rects[0]!;
const strokes = rects.slice(1);

describe("src/app/icon.svg", () => {
  it("is the caesura — a tile and two upright strokes — not the old ◎", () => {
    expect(svg).not.toMatch(/<circle\b/);
    expect(strokes).toHaveLength(2);
    for (const s of strokes) expect(s.height).toBeGreaterThan(s.width);
    // Centred on the tile, both ways.
    const left = Math.min(...strokes.map((s) => s.x));
    const right = Math.max(...strokes.map((s) => s.x + s.width));
    expect(left + right).toBe(tile.width);
    for (const s of strokes) expect(s.y * 2 + s.height).toBe(tile.height);
  });

  it("paints what the Ledger header paints: brand tile, surface strokes", () => {
    expect(tile.fill).toBe(ledgerColorToken(css, "brand"));
    for (const s of strokes) expect(s.fill).toBe(ledgerColorToken(css, "surface"));
  });

  // The maskable icon is this geometry full-bleed, and an OS may crop it to any
  // shape that contains the circle of radius 40% of the edge.
  it("keeps every stroke corner inside the maskable safe zone", () => {
    const c = tile.width / 2;
    const corners = strokes.flatMap((s) =>
      [s.x, s.x + s.width].flatMap((x) => [s.y, s.y + s.height].map((y) => ({ x, y }))),
    );
    // With no strokes the loop below asserts nothing; ◎'s file has none.
    expect(corners).toHaveLength(8);
    for (const { x, y } of corners) expect(Math.hypot(x - c, y - c)).toBeLessThanOrEqual(0.4 * tile.width);
  });
});
