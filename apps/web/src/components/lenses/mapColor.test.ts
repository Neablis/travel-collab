import { describe, expect, it } from "vitest";
import { mapPaintColor, oklchToHex } from "./mapColor";

// KI-2026-09-19-f's fix sketch asked for the conversion AND a test, because
// the failure mode is silent: MapLibre renders an unparseable colour as black
// with no exception and no warning, so nothing else in the repo goes red.
//
// **The expected values here are published sRGB primaries, not output captured
// from `oklchToHex`.** Anchoring on this module's own output would make the
// test a tautology — get the matrices wrong and both sides move together while
// it stays green, which is exactly the trap CLAUDE.md rule 3 is about.
describe("oklchToHex", () => {
  it("converts the three sRGB primaries to their exact hex", () => {
    expect(oklchToHex(0.627966, 0.257704, 29.2339)).toBe("#ff0000");
    expect(oklchToHex(0.86644, 0.294827, 142.4953)).toBe("#00ff00");
    expect(oklchToHex(0.452014, 0.313214, 264.052)).toBe("#0000ff");
  });

  it("converts the achromatic endpoints exactly", () => {
    expect(oklchToHex(0, 0, 0)).toBe("#000000");
    expect(oklchToHex(1, 0, 0)).toBe("#ffffff");
  });

  it("clamps out-of-gamut colour into sRGB instead of emitting nonsense", () => {
    const hex = oklchToHex(0.7, 0.4, 150);
    expect(hex).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("mapPaintColor", () => {
  const FALLBACK = "#123456";

  // The hazard the KI describes, end to end: a token written in `oklch`, read
  // back verbatim by `getComputedStyle`, must not reach MapLibre as `oklch`.
  it("converts an oklch token — the value that would render black in silence", () => {
    expect(mapPaintColor("oklch(0.627966 0.257704 29.2339)", FALLBACK)).toBe("#ff0000");
  });

  it("accepts the percentage spelling of lightness and chroma", () => {
    // Chroma percentages are relative to 0.4, so 64.426% is 0.257704.
    expect(mapPaintColor("oklch(62.7966% 64.426% 29.2339)", FALLBACK)).toBe("#ff0000");
  });

  it("drops alpha rather than emitting an #rrggbbaa MapLibre would reject", () => {
    expect(mapPaintColor("oklch(0.627966 0.257704 29.2339 / 0.5)", FALLBACK)).toBe("#ff0000");
  });

  // Not a normaliser. Rewriting values that already work would be a second way
  // to introduce the very bug this prevents.
  it("returns anything MapLibre already parses untouched", () => {
    expect(mapPaintColor("#0e7c66", FALLBACK)).toBe("#0e7c66");
    expect(mapPaintColor("rgb(14, 124, 102)", FALLBACK)).toBe("rgb(14, 124, 102)");
    expect(mapPaintColor("hsl(170 79% 27%)", FALLBACK)).toBe("hsl(170 79% 27%)");
    expect(mapPaintColor("rebeccapurple", FALLBACK)).toBe("rebeccapurple");
  });

  // A value we cannot convert is one MapLibre would paint black. A visibly
  // wrong-but-present colour beats an invisible line.
  it("falls back rather than passing through an oklch it cannot parse", () => {
    expect(mapPaintColor("oklch(not a colour)", FALLBACK)).toBe(FALLBACK);
    expect(mapPaintColor("", FALLBACK)).toBe(FALLBACK);
  });

  it("handles the empty string a missing custom property resolves to", () => {
    expect(mapPaintColor("   ", FALLBACK)).toBe(FALLBACK);
  });
});
