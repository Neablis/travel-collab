import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sampleRate } from "./sentry.shared";

/**
 * Every environment name `sentry.shared.ts` reads at module scope. Keep this
 * list in step with the `process.env.*` reads over there — a name the module
 * reads and this list omits is a name the fixture below does not control.
 */
const MODULE_ENV_NAMES = [
  "NEXT_PUBLIC_SENTRY_DSN",
  "NEXT_PUBLIC_VERCEL_ENV",
  "VERCEL_ENV",
  "NODE_ENV",
  "NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA",
  "VERCEL_GIT_COMMIT_SHA",
  "NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE",
  "SENTRY_TRACES_SAMPLE_RATE",
  "NEXT_PUBLIC_SENTRY_PROFILE_SESSION_SAMPLE_RATE",
  "SENTRY_PROFILE_SESSION_SAMPLE_RATE",
] as const;

/**
 * Re-import the module with a fresh registry so the module-scope `process.env`
 * reads see the stubbed values. Same mechanic, and same reason, as
 * `next.config.test.ts`'s `cspFor`.
 *
 * **Clearing comes first, and it is the whole point (KI-96).** `vi.stubEnv`
 * sets the names it is given; it does not clear the ones it is not. Without
 * the clearing pass, a case that names one variable — or none — imported the
 * module with whatever the surrounding shell had for the rest, so
 * `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE=0.2` exported in a terminal made
 * "honours the server-only name" and "defaults to 1" *fail*: green in CI and
 * on a clean checkout, red on that machine, with the module rather than the
 * fixture as the natural first suspect. `afterEach`'s `vi.unstubAllEnvs()`
 * puts the real values back.
 */
async function moduleWith(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const key of MODULE_ENV_NAMES) vi.stubEnv(key, undefined);
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
    const mod = await moduleWith({ [publicName]: "0.25", [serverName]: "0.75" });
    expect(mod[rate]).toBe(0.25);
  });

  it.each([
    ["tracesSampleRate", "SENTRY_TRACES_SAMPLE_RATE"],
    ["profileSessionSampleRate", "SENTRY_PROFILE_SESSION_SAMPLE_RATE"],
  ] as const)("%s still honours the server-only name when no public one is set", async (rate, serverName) => {
    const mod = await moduleWith({ [serverName]: "0.5" });
    expect(mod[rate]).toBe(0.5);
  });

  it.each(["tracesSampleRate", "profileSessionSampleRate"] as const)(
    "%s defaults to 1 when neither is set",
    async (rate) => {
      const mod = await moduleWith({});
      expect(mod[rate]).toBe(1);
    },
  );

  // The precedence must not swallow a typo in the public name — it would land
  // on the SERVER value and look like the public one worked.
  it("falls through a malformed public value to the fallback, not to the server value", async () => {
    const mod = await moduleWith({
      NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: "10%",
      SENTRY_TRACES_SAMPLE_RATE: "0.75",
    });
    expect(mod.tracesSampleRate).toBe(1);
  });
});

/**
 * The fixture's own regression test (KI-96).
 *
 * These stub a name the case does NOT pass to `moduleWith`, which is exactly
 * what an exported shell variable looks like from inside the run. Both fail
 * against the pre-KI-96 fixture — the first read 0.2 instead of 0.5, the
 * second 0.4 instead of 1 — and that is the whole defect: not a hollow pass,
 * a false FAILURE on whichever machine happens to export one of these.
 */
describe("the fixture controls the environment it does not name", () => {
  it("ignores an ambient public name when the case names only the server one", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE", "0.2");
    const mod = await moduleWith({ SENTRY_TRACES_SAMPLE_RATE: "0.5" });
    expect(mod.tracesSampleRate).toBe(0.5);
  });

  it("ignores every ambient name when the case names none", async () => {
    for (const name of MODULE_ENV_NAMES) vi.stubEnv(name, "0.4");
    const mod = await moduleWith({});
    expect(mod.tracesSampleRate).toBe(1);
    expect(mod.profileSessionSampleRate).toBe(1);
  });
});

/**
 * `SENTRY_DSN` and `SENTRY_ENVIRONMENT` are read through the same
 * public-name-first ladder as the sample rates, and for the same
 * browser-bundle reason — so they get the same precedence cases. Neither had
 * one before KI-96; the fixture that makes them possible is the one above.
 */
describe("SENTRY_DSN", () => {
  it("prefers NEXT_PUBLIC_SENTRY_DSN over the built-in literal", async () => {
    const dsn = "https://abc@o1.ingest.us.sentry.io/2";
    const mod = await moduleWith({ NEXT_PUBLIC_SENTRY_DSN: dsn });
    expect(mod.SENTRY_DSN).toBe(dsn);
    expect(mod.sentryEnabled).toBe(true);
  });

  // Deliberately not pinning the literal itself: the fallback exists so a
  // project rename is one variable away, and a test that hard-codes the
  // project id would have to be edited by that rename. What matters is that
  // an unset variable still lands on a real ingest DSN rather than on "".
  it("falls back to a real ingest DSN when the public name is unset", async () => {
    const mod = await moduleWith({});
    expect(mod.SENTRY_DSN).toMatch(/^https:\/\/\w+@o\d+\.ingest\.\w+\.sentry\.io\/\d+$/);
    expect(mod.sentryEnabled).toBe(true);
  });

  // The documented off switch — `Sentry.init({ dsn: "" })` is the SDK's own
  // no-op. An empty string must survive the `??`, not fall through to the
  // literal, or there would be no way to turn telemetry off.
  it("treats an empty public DSN as deliberately disabled", async () => {
    const mod = await moduleWith({ NEXT_PUBLIC_SENTRY_DSN: "" });
    expect(mod.SENTRY_DSN).toBe("");
    expect(mod.sentryEnabled).toBe(false);
  });
});

describe("SENTRY_ENVIRONMENT", () => {
  // The one that matters in the browser: NODE_ENV is "production" in every
  // built app, preview included, so without the public name every preview
  // page would file its errors against production.
  it("prefers NEXT_PUBLIC_VERCEL_ENV over VERCEL_ENV and NODE_ENV", async () => {
    const mod = await moduleWith({
      NEXT_PUBLIC_VERCEL_ENV: "preview",
      VERCEL_ENV: "production",
      NODE_ENV: "production",
    });
    expect(mod.SENTRY_ENVIRONMENT).toBe("preview");
  });

  it("falls back to VERCEL_ENV when no public name is set", async () => {
    const mod = await moduleWith({ VERCEL_ENV: "production", NODE_ENV: "development" });
    expect(mod.SENTRY_ENVIRONMENT).toBe("production");
  });

  it("falls back to NODE_ENV when neither Vercel name is set", async () => {
    const mod = await moduleWith({ NODE_ENV: "test" });
    expect(mod.SENTRY_ENVIRONMENT).toBe("test");
  });

  it("defaults to development when none of the three is set", async () => {
    const mod = await moduleWith({});
    expect(mod.SENTRY_ENVIRONMENT).toBe("development");
  });
});

describe("the fixture's environment registry", () => {
  // `MODULE_ENV_NAMES` above carries a comment telling the next person to keep
  // it in step with `sentry.shared.ts`. That was the entire enforcement: a
  // name added to the module and forgotten here is a name `moduleWith` does
  // not clear, which silently reinstates the exact ambient leakage KI-96 was
  // filed for. This reads the module's own source and makes the drift fail.
  it("lists every environment name sentry.shared.ts actually reads, and no others", () => {
    const source = readFileSync(fileURLToPath(new URL("./sentry.shared.ts", import.meta.url)), "utf8");
    // Comments in that file mention `process.env.NEXT_PUBLIC_*` prose-style,
    // which a naive scan would read as a variable named `NEXT_PUBLIC_`.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const read = [...code.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]!);

    // Equality, not containment: an extra name here is harmless to clear but
    // means the list has drifted from the module and can no longer be trusted
    // as a description of it. An empty `read` (a broken scan) fails this too,
    // so the assertion cannot pass vacuously.
    expect([...new Set(read)].sort()).toEqual([...MODULE_ENV_NAMES].sort());
  });
});
