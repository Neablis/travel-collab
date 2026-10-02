import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inviteCopy, playbookCityCopy, playbookDayCopy, playbookProfileCopy, referralCopy } from "./copy";

// Every character the cards print in their OWN words must exist in the fonts
// `card.tsx` bundles, or satori draws a box. "★ 4.6 (12)" shipped as "□ 4.6
// (12)" because none of the three fonts carries U+2605 (Mitchell, 2026-10-02,
// from a meta-tag inspector). Inputs here are plain ASCII on purpose: what is
// under test is the template, not a name or a city a person typed.

/** The code points a TrueType font maps, read from its format-4 `cmap` subtable. */
function codePoints(file: string): Set<number> {
  const font = readFileSync(join(__dirname, "fonts", file));
  const tables = font.readUInt16BE(4);
  let cmap = -1;
  for (let i = 0; i < tables; i++) {
    const entry = 12 + i * 16;
    if (font.toString("latin1", entry, entry + 4) === "cmap") cmap = font.readUInt32BE(entry + 8);
  }
  if (cmap < 0) throw new Error(`${file}: no cmap table`);
  const subtables = font.readUInt16BE(cmap + 2);
  for (let i = 0; i < subtables; i++) {
    const record = cmap + 4 + i * 8;
    const offset = cmap + font.readUInt32BE(record + 4);
    if (font.readUInt16BE(offset) !== 4) continue;
    const segments = font.readUInt16BE(offset + 6) / 2;
    const ends = offset + 14;
    const starts = ends + segments * 2 + 2;
    const deltas = starts + segments * 2;
    const ranges = deltas + segments * 2;
    const mapped = new Set<number>();
    for (let s = 0; s < segments; s++) {
      const end = font.readUInt16BE(ends + s * 2);
      const start = font.readUInt16BE(starts + s * 2);
      const delta = font.readInt16BE(deltas + s * 2);
      const rangeOffset = font.readUInt16BE(ranges + s * 2);
      for (let c = start; c <= end && c !== 0xffff; c++) {
        const glyph =
          rangeOffset === 0
            ? (c + delta) & 0xffff
            : font.readUInt16BE(ranges + s * 2 + rangeOffset + (c - start) * 2);
        if (glyph !== 0) mapped.add(c);
      }
    }
    return mapped;
  }
  throw new Error(`${file}: no format-4 cmap subtable`);
}

const FONTS = ["BricolageGrotesque-SemiBold.ttf", "IBMPlexSans-Regular.ttf", "IBMPlexSans-Medium.ttf"];

const day = { kind: "day" as const, name: "Day", cities: ["Kyoto", "Uji"], dayCount: 3, stopCount: 12, author: "Dana R.", rating: 4.6, reviewCount: 12 };
const copies = [
  playbookDayCopy(day),
  playbookDayCopy({ ...day, dayCount: 1, stopCount: 1, reviewCount: 1, rating: 5 }),
  playbookDayCopy({ kind: "generic" }),
  playbookProfileCopy({ kind: "profile", author: "Dana R.", playbooksShared: 3, adds: 7, cities: ["Kyoto"] }),
  playbookCityCopy({ kind: "city", city: "Kyoto", days: 7 }),
  referralCopy("Dana"),
  referralCopy(null),
  inviteCopy({ kind: "generic" }),
];

describe("the cards' own words", () => {
  it.each(FONTS)("draw with glyphs %s actually has", (file) => {
    const mapped = codePoints(file);
    const missing = new Set<string>();
    for (const copy of copies) {
      for (const text of [copy.label, copy.title, copy.description]) {
        for (const ch of text) if (!mapped.has(ch.codePointAt(0)!)) missing.add(ch);
      }
    }
    expect([...missing]).toEqual([]);
  });
});
