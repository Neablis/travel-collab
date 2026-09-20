// Turning a design token into something MapLibre can actually paint.
//
// **This module exists because of KI-2026-09-19-f.** MapLibre parses CSS
// Color 3 only, and when handed a colour it cannot parse it falls back to
// black **in silence** — no exception, no console warning, no failed layer.
// `getComputedStyle().getPropertyValue()` PRESERVES `oklch()` verbatim, so
// reading a token that way and passing the string into `"line-color"` or
// `new Marker({ color })` looks exactly like a fix and is not
// (`.design-sync/handoff/DRIFT.md` §6, build-check 2).
//
// Today every accent token in `globals.css` happens to be hex, so the existing
// map is correct BY ACCIDENT — the file says so itself at :213-214, a policy
// stated in a CSS comment with nothing enforcing it. SPEC §28's Ledger look
// bumps "tint chroma and the solid", which is the natural thing to express in
// `oklch`, so the next person to touch that token blacks out every route line
// and every marker and nothing in the repo tells them.
//
// The KI's fix sketch asks for the conversion AND a test. This is the
// conversion; `mapColor.test.ts` is the test, and it anchors on the three
// published sRGB primaries rather than on values produced by this same code.

/** Clamp to the unit interval — out-of-gamut OKLCH is a real possibility. */
function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Linear-light channel to gamma-encoded sRGB (the CSS transfer function). */
function gammaEncode(channel: number): number {
  const c = clamp01(channel);
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

function toHexPair(channel: number): string {
  return Math.round(gammaEncode(channel) * 255)
    .toString(16)
    .padStart(2, "0");
}

/**
 * `oklch(L C H)` → a `#rrggbb` string, arithmetically.
 *
 * L accepts both the 0–1 number form and the percentage form; both spellings
 * are legal CSS and both appear in the wild. Alpha (`/ 0.5`) is accepted and
 * DROPPED — every call site here paints an opaque line or marker, and silently
 * losing an alpha is better than emitting an `#rrggbbaa` that MapLibre's CSS
 * Color 3 parser would itself reject, which is the bug this module prevents.
 */
export function oklchToHex(lightness: number, chroma: number, hueDegrees: number): string {
  const hue = (hueDegrees * Math.PI) / 180;
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);

  // OKLab → LMS', cubed back to LMS (Björn Ottosson's published matrices).
  const lCube = lightness + 0.3963377774 * a + 0.2158037573 * b;
  const mCube = lightness - 0.1055613458 * a - 0.0638541728 * b;
  const sCube = lightness - 0.0894841775 * a - 1.291485548 * b;
  const l = lCube * lCube * lCube;
  const m = mCube * mCube * mCube;
  const s = sCube * sCube * sCube;

  // LMS → linear sRGB.
  const red = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const green = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const blue = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  return `#${toHexPair(red)}${toHexPair(green)}${toHexPair(blue)}`;
}

/**
 * What a map paints when a token will not resolve or will not convert.
 *
 * It lives HERE, not at the call sites, for two reasons. It is this module's
 * answer rather than any one map's, so two maps cannot drift to two different
 * "something went wrong" colours. And this is the one file in the tree where a
 * colour literal is the subject matter rather than a design decision, which is
 * why the colour wall exempts it by name — a constant spelled here is reviewed
 * as conversion code, not smuggled past the wall.
 *
 * Deliberately `--color-brand`'s own value: a fallback that is visibly wrong
 * would be a second design, and the failure this guards is "the token did not
 * arrive", not "the token was the wrong colour".
 */
export const MAP_COLOR_FALLBACK = "#0e7c66";

const OKLCH = /^oklch\(\s*([\d.]+%?)\s+([\d.]+%?)\s+([\d.]+)(?:deg)?\s*(?:\/.*)?\)$/i;

function scalar(token: string, percentBasis: number): number {
  return token.endsWith("%") ? Number.parseFloat(token) / 100 * percentBasis : Number.parseFloat(token);
}

/**
 * A computed CSS colour, made safe to hand to a MapLibre paint property.
 *
 * Anything MapLibre already parses (hex, `rgb()`, `hsl()`, a named colour) is
 * returned untouched — this is not a normaliser, and rewriting values that
 * already work would be a second way to introduce the very bug it prevents.
 * Only `oklch()`, the one spelling that fails silently, is converted.
 *
 * An `oklch()` that does not parse returns `fallback` rather than the original
 * string. That is the whole point: a value this function does not understand is
 * a value MapLibre will render as black, and a visibly wrong-but-present colour
 * beats an invisible line every time.
 */
export function mapPaintColor(computed: string, fallback: string = MAP_COLOR_FALLBACK): string {
  const value = computed.trim();
  if (value === "") return fallback;
  if (!/^oklch\(/i.test(value)) return value;

  const parts = OKLCH.exec(value);
  if (parts === null) return fallback;
  // Percentage chroma is relative to 0.4 per the CSS Color 4 definition, not
  // to 1 — getting this wrong desaturates rather than failing, which is the
  // kind of wrong nobody notices.
  const lightness = scalar(parts[1]!, 1);
  const chroma = scalar(parts[2]!, 0.4);
  const hue = Number.parseFloat(parts[3]!);
  if (!Number.isFinite(lightness) || !Number.isFinite(chroma) || !Number.isFinite(hue)) return fallback;
  return oklchToHex(lightness, chroma, hue);
}
