// **No automated test may talk to a real third party** (Mitchell, 2026-09-24).
// A third party's failure is covered by a UI placeholder tested against an MSW
// stub, and its success by a manual walkthrough on a Vercel preview — never by
// a test that dials out. This module is the unit and integration lanes' half of
// enforcing that: any `fetch` to a host that is not this machine rejects, loudly,
// naming the URL.
//
// **Why it has to be enforced rather than remembered.** The integration lane
// loads `.env.local`, which on a developer machine carries real LocationIQ,
// AI Gateway and Stripe keys. A test that forgets a stub does not fail there —
// it succeeds against the real vendor, spends real quota, and goes red in CI
// where the key is absent. That is the worst shape a test can have.
//
// **How it composes with MSW.** `setupServer().listen()` (called in a test
// file's `beforeAll`, i.e. after the setup file that installs this) captures
// whatever `globalThis.fetch` is at that moment as its passthrough and wraps it.
// So a request MSW has a handler for is answered by MSW and never reaches this;
// an unhandled one under the default `onUnhandledRequest: "warn"` passes
// through to this and is rejected here; under `"error"` MSW refuses it first.
//
// **Only `fetch`.** Every third-party client in `src/server` (LocationIQ,
// Stripe's REST calls, the AI SDK's gateway provider) uses `fetch`, and so does
// every browser-side client. Node's `http`/`https`, `XMLHttpRequest`,
// `navigator.sendBeacon` and `WebSocket` are not guarded; nothing a test
// imports uses them today (the Sentry SDK's node transport does, which is why
// every test that initialises Sentry passes its own in-memory `transport`).

const GUARDED = Symbol.for("travel-collab.networkGuard");

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** The origin a relative URL resolves against: jsdom's `location`, else localhost. */
function currentBase(): string {
  const location = (globalThis as { location?: { href?: string } }).location;
  return location?.href && location.href !== "about:blank" ? location.href : "http://localhost/";
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/**
 * The message a blocked request rejects with. Exported so the guard's own test
 * asserts the exact text a developer will see.
 */
export function blockedRequestMessage(url: string): string {
  return (
    `Blocked network request to ${url}: automated tests may not reach a third party; ` +
    `stub it with MSW (see docs/guidelines/testing.md).`
  );
}

/**
 * True when `url` (absolute, or relative to the current page) names this
 * machine: `localhost`, `127.0.0.1` or `::1`. Anything unparseable is treated
 * as local so the underlying `fetch` reports its own error for it.
 */
export function isLocalUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url, currentBase());
  } catch {
    return true;
  }
  if (parsed.protocol === "data:" || parsed.protocol === "blob:") return true;
  return LOCAL_HOSTNAMES.has(parsed.hostname);
}

/**
 * Wraps `inner` so a request to anything other than this machine rejects with
 * {@link blockedRequestMessage} instead of reaching the network. Local requests
 * are handed to `inner` unchanged.
 */
export function guardFetch(inner: typeof fetch): typeof fetch {
  const guarded = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = requestUrl(input);
    if (!isLocalUrl(url)) return Promise.reject(new Error(blockedRequestMessage(url)));
    return inner(input, init);
  };
  return Object.assign(guarded, { [GUARDED]: true }) as typeof fetch;
}

/**
 * Replaces `globalThis.fetch` with the guarded version. Idempotent, so a test
 * that imports this module after the setup file already ran does not wrap the
 * guard in itself.
 */
export function installNetworkGuard(): void {
  const current = globalThis.fetch as typeof fetch & { [GUARDED]?: boolean };
  if (typeof current !== "function" || current[GUARDED]) return;
  globalThis.fetch = guardFetch(current);
}
