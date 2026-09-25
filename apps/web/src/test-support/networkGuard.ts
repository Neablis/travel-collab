// **No automated test may talk to a real third party** (Mitchell, 2026-09-24).
// A third party's failure is covered by a UI placeholder tested against an MSW
// stub, and its success by a manual walkthrough on a Vercel preview — never by
// a test that dials out. This module is the unit and integration lanes' half of
// enforcing that: any request to a host that is not this machine fails, loudly,
// naming where it was going. The one exception is at the socket layer: the host
// `DATABASE_URL` names, which is the lane's own Postgres even when that is
// `db` or `host.docker.internal` rather than `localhost`.
//
// **Why it has to be enforced rather than remembered.** The integration lane
// loads `.env.local`, which on a developer machine carries real LocationIQ,
// AI Gateway and Stripe keys. A test that forgets a stub does not fail there —
// it succeeds against the real vendor, spends real quota, and goes red in CI
// where the key is absent. That is the worst shape a test can have.
//
// **Two layers.** `fetch` is guarded at the call, so its rejection names the
// full URL. Everything else — Node's `http`/`https` (`request` and `get`),
// jsdom's `XMLHttpRequest`, `WebSocket` in either environment, and any library
// built on them — is guarded where all of it ends up: `net.Socket#connect`,
// which `net.connect`, `tls.connect` and undici all call. A connect to a
// non-local host is refused there with the same message, emitted as the
// socket's `error` the way a real connection failure is. `sendBeacon` needs no
// guard of its own: neither Node nor jsdom implements it, and if jsdom ever
// does it will be built on the same sockets. (KI-2026-09-24-u.)
//
// **Why the socket and not `http.request`.** MSW's `ClientRequestInterceptor`
// wraps `http.request` in a Proxy that calls whatever it wrapped — for EVERY
// request, handled or not, with its own agent whose sockets are
// `MockHttpSocket`s. A guard on `http.request` would therefore refuse requests
// MSW was about to answer. `MockHttpSocket` overrides `connect`, so a handled
// request never reaches `net.Socket#connect`; only a passthrough does, through
// the real agent's `createConnection` — which is exactly the one to refuse.
//
// **How the fetch guard composes with MSW.** `setupServer().listen()` (called
// in a test file's `beforeAll`, i.e. after the setup file that installs this)
// captures whatever `globalThis.fetch` is at that moment as its passthrough
// and wraps it. So a request MSW has a handler for is answered by MSW and never
// reaches this; an unhandled one under the default `onUnhandledRequest: "warn"`
// passes through to this and is rejected here; under `"error"` MSW refuses it
// first.
//
// **What it does not cover.** A worker thread or child process gets its own
// `net` module, unpatched — which includes jsdom's SYNCHRONOUS XHR, run in a
// worker. And a request sent through an HTTP proxy on this machine connects to
// the proxy, which is local; Node only does that when `NODE_USE_ENV_PROXY` is
// set, which neither lane does. The Sentry SDK's node transport is closed
// separately, by `networkGuard.setup.ts` forcing `NEXT_PUBLIC_SENTRY_DSN`
// empty.

import net from "node:net";

const GUARDED = Symbol.for("travel-collab.networkGuard");

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "::1"]);

/**
 * True for a name or address that is this machine. Any subdomain of
 * `localhost` is loopback (RFC 6761 §6.3), and both Chromium and Node's
 * resolver answer it that way; it is matched on the dot, so
 * `localhost.example.com` and `notlocalhost` stay third parties. All of
 * 127.0.0.0/8 is loopback, not only `127.0.0.1`: Debian-family hosts map their
 * own hostname to `127.0.1.1`.
 */
function isLocalHostname(hostname: string): boolean {
  return (
    LOCAL_HOSTNAMES.has(hostname) ||
    hostname.endsWith(".localhost") ||
    (net.isIPv4(hostname) && hostname.startsWith("127."))
  );
}

/**
 * The host `DATABASE_URL` names, or undefined when it is unset or unparseable.
 * Read per call, not at install, because the integration lane's
 * `with-test-db.mjs` and `vi.stubEnv` both set it after this module loads.
 */
function databaseHost(): string | undefined {
  const url = process.env.DATABASE_URL;
  if (!url) return undefined;
  try {
    return new URL(url).hostname || undefined;
  } catch {
    return undefined;
  }
}

/**
 * True when a socket may connect to `host`: this machine, or the database the
 * lane was told to use. That database is often not `localhost` — `db:5432` or
 * `postgres` in a container, `host.docker.internal` on Docker Desktop — and it
 * is the lane's own infrastructure, not a third party. The fetch guard does not
 * use this: nothing talks HTTP to Postgres.
 */
export function isAllowedSocketHost(host: string): boolean {
  if (isLocalHostname(host)) return true;
  const database = databaseHost();
  // `URL` keeps an IPv6 literal bracketed; a connect call is given it bare.
  return database !== undefined && (database === host || database === `[${host}]`);
}

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
 * machine: `localhost` or any `*.localhost`, 127.0.0.0/8, `0.0.0.0` or `::1`.
 * Anything unparseable is treated as local so the underlying `fetch` reports
 * its own error for it.
 */
export function isLocalUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url, currentBase());
  } catch {
    return true;
  }
  if (parsed.protocol === "data:" || parsed.protocol === "blob:") return true;
  return isLocalHostname(parsed.hostname);
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
 * Replaces `globalThis.fetch` with the guarded version and installs the
 * socket guard beneath everything else. Idempotent, so a test
 * that imports this module after the setup file already ran does not wrap the
 * guard in itself.
 */
export function installNetworkGuard(): void {
  installSocketGuard();
  const current = globalThis.fetch as typeof fetch & { [GUARDED]?: boolean };
  if (typeof current !== "function" || current[GUARDED]) return;
  globalThis.fetch = guardFetch(current);
}

type ConnectArgs = Parameters<net.Socket["connect"]>;

/**
 * The host a `net.Socket#connect` call is dialling, or `undefined` for a Unix
 * socket / named pipe. Accepts every overload plus the pre-normalised array
 * `net.connect` and `tls.connect` pass internally. An omitted host is
 * `localhost`, as it is to Node.
 */
export function connectTarget(args: readonly unknown[]): { host: string; port?: number } | undefined {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  if (first !== null && typeof first === "object") {
    const options = first as { host?: string | null; port?: number | string | null; path?: string | null };
    // Truthiness, as Node's own `net` decides it: `http` hands its sockets
    // `path: null`, and that is a TCP connect, not a pipe.
    if (options.path) return undefined;
    return { host: options.host || "localhost", port: options.port == null ? undefined : Number(options.port) };
  }
  if (typeof first === "number" || (typeof first === "string" && /^\d+$/.test(first))) {
    return { host: typeof args[1] === "string" && args[1] ? args[1] : "localhost", port: Number(first) };
  }
  return undefined;
}

/**
 * Patches `net.Socket.prototype.connect` so a connection to anything other
 * than this machine or the database is destroyed with
 * {@link blockedRequestMessage} before it is attempted — no DNS lookup, no
 * packet. Local hosts, Unix sockets, and whatever host `DATABASE_URL` names
 * (see {@link isAllowedSocketHost}) connect as normal. Idempotent.
 */
export function installSocketGuard(): void {
  const proto = net.Socket.prototype as net.Socket & { [GUARDED]?: boolean };
  if (proto[GUARDED]) return;
  const original = proto.connect;
  proto.connect = function guardedConnect(this: net.Socket, ...args: ConnectArgs) {
    const target = connectTarget(args);
    if (target && !isAllowedSocketHost(target.host)) {
      const where = target.port === undefined ? target.host : `${target.host}:${target.port}`;
      const error = new Error(blockedRequestMessage(where));
      // Also said out loud, because the socket error is not always what a
      // test sees: XHR reports a bare network error and WebSocket a 1006
      // close, neither of which carries this message.
      console.error(error.message);
      process.nextTick(() => this.destroy(error));
      return this;
    }
    return original.apply(this, args);
  } as net.Socket["connect"];
  Object.defineProperty(proto, GUARDED, { value: true });
}
