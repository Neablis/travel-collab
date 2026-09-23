import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mapPaintColor, MAP_COLOR_FALLBACK } from "./mapColor";

// The other half of KI-2026-09-19-f's fix sketch: *"either an arithmetic
// oklch → sRGB conversion behind `accentVar`, or a test that asserts every
// accent token resolves to a CSS Color 3 value. **Prefer the test AND the
// conversion**."*
//
// The conversion is `mapColor.ts`. This is the test, and it exists because the
// conversion alone does not close the hole: `mapPaintColor` handles `oklch()`,
// the spelling the KI predicted, but returns anything else UNTOUCHED — and
// `lab()`, `lch()` and `color(display-p3 …)` are all CSS Color 4 too. A token
// written in one of those still reaches MapLibre unparseable and still renders
// black in silence.
//
// So this asserts the property that actually matters: **every colour token in
// `globals.css` survives the trip to a map paint property.** It reads the real
// stylesheet rather than a copy, because the failure this guards is somebody
// editing that file.

const GLOBALS = join(import.meta.dirname, "../../app/globals.css");

/**
 * Every `--color-*: <value>` declaration in the stylesheet, **with `var()`
 * aliases followed to the value they end at**.
 *
 * Resolving aliases is not a convenience — it is what makes this test match
 * reality. Three tokens are aliases today (`--color-a-you-rule: var(--color-brand)`
 * and two neighbours), and the BROWSER resolves a `var()` chain before
 * `getComputedStyle` ever returns it, so the string that actually reaches
 * MapLibre is the hex at the end of the chain. Asserting against the literal
 * `var(--color-brand)` would fail on tokens that are perfectly fine, and — far
 * worse — would pass on an alias POINTING AT a bad value, which is exactly the
 * case this test is for.
 */
function colorTokens(): { name: string; value: string }[] {
  const css = readFileSync(GLOBALS, "utf8");
  // Strip block comments first: this repo records defects IN comments, and a
  // commented-out token is not a token.
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const declared = [...withoutComments.matchAll(/(--color-[a-z0-9-]+)\s*:\s*([^;]+);/gi)].map((m) => ({
    name: m[1]!,
    value: m[2]!.trim(),
  }));

  // Last declaration wins, as the cascade does — the `data-look` overrides at
  // the end of the file re-point several of these deliberately.
  const byName = new Map(declared.map((t) => [t.name, t.value]));

  const resolve = (value: string, seen: Set<string>): string => {
    const alias = /^var\(\s*(--color-[a-z0-9-]+)\s*\)$/i.exec(value);
    if (alias === null) return value;
    const target = alias[1]!;
    // A cycle would otherwise recurse forever. It is also a real defect, so
    // returning the unresolved text makes the assertion below fail loudly
    // rather than hanging the run.
    if (seen.has(target)) return value;
    const next = byName.get(target);
    if (next === undefined) return value;
    return resolve(next, new Set(seen).add(target));
  };

  return declared
    .filter((t) => t.value !== "initial")
    .map((t) => ({ name: t.name, value: resolve(t.value, new Set([t.name])) }));
}

describe("every colour token can reach a MapLibre paint property", () => {
  it("finds the tokens at all — a zero-length sweep would pass vacuously", () => {
    // Without this, a change to `globals.css`'s shape that broke the regex
    // above would turn every assertion below into a loop over nothing, and
    // this file would go green while checking exactly zero tokens.
    expect(colorTokens().length).toBeGreaterThan(20);
  });

  it.each(colorTokens())("$name survives conversion to CSS Color 3", ({ value }) => {
    const painted = mapPaintColor(value);

    // Not the fallback: that is what `mapPaintColor` returns when it gave up,
    // and a token that lands there is one the map cannot honour.
    expect(painted).not.toBe(MAP_COLOR_FALLBACK === value ? "\u0000never" : MAP_COLOR_FALLBACK);

    // CSS Color 3 is hex, rgb()/rgba(), hsl()/hsla(), and the named colours.
    // Anything else — lab(), lch(), color(display-p3 …), oklab() — is a value
    // MapLibre renders black in silence, which is the whole defect.
    expect(painted).toMatch(/^(#[0-9a-f]{3,8}|rgba?\(|hsla?\(|[a-z]+$)/i);
    expect(painted).not.toMatch(/^(lab|lch|oklab|color)\(/i);
  });
});
