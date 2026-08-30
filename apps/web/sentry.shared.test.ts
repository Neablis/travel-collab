import { afterEach, describe, expect, it, vi } from "vitest";
import { sampleRate } from "./sentry.shared";

afterEach(() => {
  vi.unstubAllEnvs();
});

/**
 * `sampleRate` is three lines, and it exists because of one failure mode that
 * is invisible from the outside.
 *
 * Sentry decides whether to sample with `Math.random() < rate`. `NaN` loses
 * every one of those comparisons, so a mistyped environment variable does not
 * error, does not warn, and does not fall back — it turns the feature OFF
 * while the deployment's config reads as if someone turned it up. The whole
 * point of these cases is that a typo lands on the documented default instead.
 */
describe("sampleRate", () => {
  it("uses the fallback when the variable is unset", () => {
    expect(sampleRate(undefined, 0.25)).toBe(0.25);
  });

  it.each(["", "   "])("uses the fallback for a variable set to blank (%o)", (raw) => {
    expect(sampleRate(raw, 1)).toBe(1);
  });

  it.each([
    ["0", 0],
    ["1", 1],
    ["0.1", 0.1],
    ["0.05", 0.05],
    [" 0.5 ", 0.5],
  ])("reads a valid rate %o as %o", (raw, expected) => {
    expect(sampleRate(raw as string, 999)).toBe(expected);
  });

  // Each of these would become NaN, and NaN silently means "never".
  it.each(["0,1", "10%", "true", "off", "one", "0.1.2"])(
    "falls back rather than turning the feature off for the typo %o",
    (raw) => {
      expect(sampleRate(raw, 0.3)).toBe(0.3);
    },
  );

  // A `2` reads as "extra on" to a human and means nothing to the SDK; a
  // negative reads as "off" but is not a rate either. Both land on the
  // documented default rather than on undefined behaviour.
  it.each(["2", "100", "-1", "Infinity", "-Infinity", "NaN"])(
    "rejects the out-of-range value %o",
    (raw) => {
      expect(sampleRate(raw, 0.3)).toBe(0.3);
    },
  );
});
