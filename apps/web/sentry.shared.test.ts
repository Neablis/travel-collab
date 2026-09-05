import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/nextjs";
import {
  REDACTED,
  sampleRate,
  scrubReplayRecordingEvent,
  scrubUrl,
  sharedSentryOptions,
} from "./sentry.shared";

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

/**
 * **KI-2026-09-05-e — share and invite bearer tokens must not reach Sentry.**
 *
 * A share link's token (ADR-026) and an invite's (ADR-027) are the whole
 * credential, and they live in the URL path. `sendDefaultPii: false` does not
 * cover URLs, so before the scrubbers existed every traced request to one of
 * those routes shipped a live secret to a third-party SaaS at 100% sampling.
 */
const TOKEN = "sh_live_TOKEN_ABC123";

describe("scrubUrl", () => {
  it.each([
    // The recipient-facing pages.
    [`/s/${TOKEN}`, `/s/${REDACTED}`],
    [`/invite/${TOKEN}`, `/invite/${REDACTED}`],
    // A full URL, which is the shape `url.full` and `request.url` carry.
    [`https://example.test/s/${TOKEN}`, `https://example.test/s/${REDACTED}`],
    // The API routes, and the suffix under them — `/clone` and `/accept` are
    // not secrets and are worth keeping in a trace.
    [`/api/shares/${TOKEN}`, `/api/shares/${REDACTED}`],
    [`/api/shares/${TOKEN}/clone`, `/api/shares/${REDACTED}/clone`],
    [`/api/invites/${TOKEN}/accept`, `/api/invites/${REDACTED}/accept`],
    // A transaction name is "METHOD path", not a bare path.
    [`GET /api/shares/${TOKEN}`, `GET /api/shares/${REDACTED}`],
    // Query and fragment end the segment; neither is part of the token.
    [`/s/${TOKEN}?utm=x#frag`, `/s/${REDACTED}?utm=x#frag`],
    // `proxy.ts` sends a signed-out visitor here, percent-encoded — which is
    // why the path patterns alone are not enough.
    [
      `/signin?callbackUrl=%2Finvite%2F${TOKEN}`,
      `/signin?callbackUrl=${REDACTED}`,
    ],
    // ...and the masking stops at the next parameter rather than eating it.
    [
      `/signin?callbackUrl=/invite/${TOKEN}&x=1`,
      `/signin?callbackUrl=${REDACTED}&x=1`,
    ],
    // Prose: an exception message that quotes a URL. Mask the token, keep the
    // sentence — a scrubbed message nobody can read is not a better outcome.
    [`request to /s/${TOKEN} failed`, `request to /s/${REDACTED} failed`],
  ])("masks %o", (raw, expected) => {
    expect(scrubUrl(raw)).toBe(expected);
  });

  // Over-masking is the safe direction, but a scrubber that mangles every path
  // makes traces useless and would be quietly reverted. These are the
  // neighbours most likely to be caught by a sloppier pattern: `shares` and
  // `invites` also appear as owner-side collections under a trip, where the id
  // is a row id and not a bearer token.
  it.each([
    "/trips/abc/days/def",
    "/api/trips/abc/shares/share-1",
    "/api/trips/abc/invites/invite-1",
    "/settings",
    "/api/health",
  ])("leaves %o alone", (raw) => {
    expect(scrubUrl(raw)).toBe(raw);
  });

  // The client applies both an event processor and `beforeSend`, so a value
  // can be scrubbed twice. If that were not a no-op the second pass would eat
  // the `[redacted]` marker it found.
  it("is idempotent", () => {
    const once = scrubUrl(`/s/${TOKEN}`);
    expect(scrubUrl(once)).toBe(once);
  });
});

/**
 * The scrubbers, checked against the bytes a real client hands its transport —
 * not against a hand-built event.
 *
 * That distinction is the whole reason this test exists rather than a unit test
 * of `beforeSend`. The nine leak sites this run covers were *discovered* by
 * dumping this envelope; a field list written from the docs would have missed
 * `contexts.trace.data["url.full"]` and `spans[].description`, and nothing
 * would ever have said so. It also pins the wiring: a `beforeSend` that exists
 * but is not spread into `Sentry.init` looks identical from a unit test.
 */
describe("what actually reaches the Sentry transport", () => {
  const sent: [unknown, Array<[{ type: string }, unknown]>][] = [];

  beforeAll(async () => {
    Sentry.init({
      ...sharedSentryOptions,
      // Well-formed and unreachable — the transport never leaves the process.
      dsn: "https://0123456789abcdef0123456789abcdef@o0.ingest.us.sentry.io/0",
      tracesSampleRate: 1,
      transport: () => ({
        send: async (envelope: unknown) => {
          sent.push(envelope as never);
          return {};
        },
        flush: async () => true,
      }),
    });

    // Exactly what `instrumentation.ts`'s `onRequestError` does for a throw
    // inside `s/[token]/page.tsx` — the reproduction named in the KI. The SDK
    // copies `request.path` into `contexts.nextjs.request_path` verbatim.
    Sentry.captureRequestError(
      new Error("boom"),
      { path: `/s/${TOKEN}`, method: "GET", headers: {} },
      { routerKind: "App Router", routePath: "/s/[token]", routeType: "render" },
    );

    await Sentry.startSpan(
      {
        name: `GET /api/shares/${TOKEN}`,
        op: "http.server",
        attributes: {
          "url.full": `https://example.test/api/shares/${TOKEN}`,
          "url.path": `/api/shares/${TOKEN}`,
          "http.route": "/api/shares/[token]",
        },
      },
      async () => {
        Sentry.addBreadcrumb({
          category: "navigation",
          data: { from: "/trips", to: `/invite/${TOKEN}` },
        });
        await Sentry.startSpan(
          { name: `GET /api/invites/${TOKEN}/accept`, op: "http.client" },
          async () => {},
        );
      },
    );

    Sentry.captureException(
      new Error(`fetch failed for /signin?callbackUrl=%2Finvite%2F${TOKEN}`),
    );

    await Sentry.flush(5000);
  });

  /** Every string anywhere in every envelope item, with its path, so a failure
   * names the field instead of saying "somewhere in 40KB of JSON". */
  function everyString(): Array<{ type: string; path: string; value: string }> {
    const found: Array<{ type: string; path: string; value: string }> = [];
    const walk = (type: string, node: unknown, path: string): void => {
      if (typeof node === "string") {
        found.push({ type, path, value: node });
        return;
      }
      if (node && typeof node === "object") {
        for (const [key, value] of Object.entries(node)) walk(type, value, `${path}.${key}`);
      }
    };
    for (const [, items] of sent) for (const [header, item] of items) walk(header.type, item, "");
    return found;
  }

  // A witness floor. `not.toContain` over an empty payload is the
  // strongest-looking, emptiest assertion available — a failed init, a dropped
  // transport or a flush that sent nothing would pass it silently.
  it("sent both an error event and a transaction", () => {
    const types = new Set(sent.flatMap(([, items]) => items.map(([header]) => header.type)));
    expect(types).toContain("event");
    expect(types).toContain("transaction");
  });

  it("carries no share or invite token in any field of any envelope item", () => {
    const leaks = everyString()
      .filter((entry) => entry.value.includes(TOKEN))
      .map((entry) => `${entry.type} :: ${entry.path} = ${entry.value}`);
    expect(leaks).toEqual([]);
  });

  // The other half of the floor: prove the scrubber ran on the fields the
  // reproduction found the token in, rather than that those fields vanished.
  it.each([
    [".transaction", `GET /api/shares/${REDACTED}`],
    [".request.url", `/api/shares/${REDACTED}`],
    ['.contexts.trace.data.url.full', `https://example.test/api/shares/${REDACTED}`],
    ['.contexts.trace.data.url.path', `/api/shares/${REDACTED}`],
    [".spans.0.description", `GET /api/invites/${REDACTED}/accept`],
    [".breadcrumbs.0.data.to", `/invite/${REDACTED}`],
    [".contexts.nextjs.request_path", `/s/${REDACTED}`],
    [".exception.values.0.value", `fetch failed for /signin?callbackUrl=${REDACTED}`],
  ])("still reports %s, masked", (path, expected) => {
    const values = everyString()
      .filter((entry) => entry.path === path)
      .map((entry) => entry.value);
    expect(values).toContain(expected);
  });
});

/**
 * Session Replay is the one signal the three `beforeSend*` hooks cannot reach.
 * `prepareReplayEvent` calls `prepareEvent` and sends; `beforeSend` lives in
 * `_processEvent`, which a replay envelope never enters. So the client wires two
 * extra hooks, and these are what stop them being deleted as redundant.
 */
describe("Session Replay", () => {
  it("scrubs the URLs out of a recording event's payload", () => {
    const recorded = {
      type: 5,
      timestamp: 0,
      data: {
        tag: "breadcrumb",
        payload: { category: "navigation", data: { from: "/trips", to: `/s/${TOKEN}` } },
      },
    };
    expect(scrubReplayRecordingEvent(recorded).data.payload.data.to).toBe(`/s/${REDACTED}`);
  });

  // A wiring check, and honest about being one: it reads source text, so it
  // proves the hooks are passed and not that Replay calls them. The end-to-end
  // alternative needs a browser and a running replay session, which is a
  // Playwright-shaped cost for a two-line wiring. What it does catch is the
  // regression that actually happens — someone tidying an option away.
  it("hands both of its bypass hooks to the client SDK", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./src/instrumentation-client.ts", import.meta.url)),
      "utf8",
    );
    expect(source).toContain("beforeAddRecordingEvent: scrubReplayRecordingEvent");
    expect(source).toContain("Sentry.addEventProcessor(scrubSentryPayload)");
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
