import { afterEach, describe, expect, it, vi } from "vitest";
import { sampleRate } from "./sentry.shared";

/**
 * Re-import the module with a fresh registry so the module-scope `process.env`
 * reads see the stubbed values. Same mechanic, and same reason, as
 * `next.config.test.ts`'s `cspFor`.
 */
async function ratesWith(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  return await import("./sentry.shared");
}

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

/**
 * **The browser-bundle trap.** `sentry.shared.ts` is imported by
 * `instrumentation-client.ts`, and Next.js inlines only `NEXT_PUBLIC_*` names
 * into the client bundle — every other name is `undefined` there. A
 * server-only variable read from this module therefore does not fail in the
 * browser, it silently returns the fallback: `SENTRY_TRACES_SAMPLE_RATE=0.1`
 * would turn tracing down on the server and leave the browser at 1.0, with
 * nothing anywhere saying so. (CodeRabbit, PR #93.)
 *
 * These cases pin the precedence. What they cannot see is Next's inlining
 * itself — that is a build-time text substitution, and the guard for it is
 * that both names are written out in full at the call site.
 */
describe("the browser-visible sample rates", () => {
  it.each([
    ["tracesSampleRate", "NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE", "SENTRY_TRACES_SAMPLE_RATE"],
    [
      "profileSessionSampleRate",
      "NEXT_PUBLIC_SENTRY_PROFILE_SESSION_SAMPLE_RATE",
      "SENTRY_PROFILE_SESSION_SAMPLE_RATE",
    ],
  ] as const)("%s prefers the public name over the server-only one", async (rate, publicName, serverName) => {
    const mod = await ratesWith({ [publicName]: "0.25", [serverName]: "0.75" });
    expect(mod[rate]).toBe(0.25);
  });

  it.each([
    ["tracesSampleRate", "SENTRY_TRACES_SAMPLE_RATE"],
    ["profileSessionSampleRate", "SENTRY_PROFILE_SESSION_SAMPLE_RATE"],
  ] as const)("%s still honours the server-only name when no public one is set", async (rate, serverName) => {
    const mod = await ratesWith({ [serverName]: "0.5" });
    expect(mod[rate]).toBe(0.5);
  });

  it.each(["tracesSampleRate", "profileSessionSampleRate"] as const)(
    "%s defaults to 1 when neither is set",
    async (rate) => {
      const mod = await ratesWith({});
      expect(mod[rate]).toBe(1);
    },
  );

  // The precedence must not swallow a typo in the public name — it would land
  // on the SERVER value and look like the public one worked.
  it("falls through a malformed public value to the fallback, not to the server value", async () => {
    const mod = await ratesWith({
      NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: "10%",
      SENTRY_TRACES_SAMPLE_RATE: "0.75",
    });
    expect(mod.tracesSampleRate).toBe(1);
  });
});
