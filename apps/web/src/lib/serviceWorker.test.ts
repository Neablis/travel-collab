import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import { witness } from "@/test-support/witness";

// M39 D4, and the exit gate's box: *the service worker never caches an API or
// token route*. Run against `public/sw.js` itself — the bytes the browser
// installs — in a sandbox with a stand-in `self`, so there is no second copy of
// the matcher to drift from the one that ships.
const ORIGIN = "https://caesura.example";

type Strategy = "cache-first" | "network";
type FetchEvent = { request: { url: string; method: string }; respondWith: (response: unknown) => void };

type LifecycleEvent = { waitUntil: (work: Promise<unknown>) => void };

/** Evaluates the worker script and hands back its matcher and its listeners. */
function loadWorker() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- each event type's listener takes its own event shape
  const listeners = new Map<string, (event: any) => void>();
  const skipWaiting = vi.fn();
  const claim = vi.fn(async () => undefined);
  const self = {
    location: new URL(ORIGIN),
    addEventListener: (type: string, listener: (event: FetchEvent) => void) => listeners.set(type, listener),
    skipWaiting,
    clients: { claim },
  };
  // A cache that always hits, so a request the worker does take over resolves
  // without a network; this file is about WHICH requests it takes, not how.
  const deleted: string[] = [];
  const caches = {
    open: async () => ({ match: async () => "cached response" }),
    keys: async () => ["caesura-static-v0", "caesura-static-v1"],
    delete: async (key: string) => deleted.push(key),
  };
  const sandbox = vm.createContext({ self, URL, caches });
  vm.runInContext(readFileSync(join(process.cwd(), "public/sw.js"), "utf8"), sandbox);
  return {
    cacheStrategyFor: (path: string) => (sandbox.cacheStrategyFor as (url: URL) => Strategy)(new URL(path, ORIGIN)),
    onFetch: listeners.get("fetch")!,
    listeners,
    skipWaiting,
    claim,
    deleted,
  };
}

/** Runs `type`'s listener, if the worker has one, and waits for its work. */
async function dispatchLifecycle(w: ReturnType<typeof loadWorker>, type: "install" | "activate"): Promise<void> {
  const work: Promise<unknown>[] = [];
  const event: LifecycleEvent = { waitUntil: (p) => work.push(p) };
  w.listeners.get(type)?.(event);
  await Promise.all(work);
}

const worker = loadWorker();

/** Whether the worker's fetch listener takes over a GET for `path`. */
function intercepts(path: string): boolean {
  const respondWith = vi.fn();
  worker.onFetch({ request: { url: new URL(path, ORIGIN).href, method: "GET" }, respondWith });
  return respondWith.mock.calls.length > 0;
}

describe("the service worker's routes (M39 D4)", () => {
  it.each([
    "/api/trips/x",
    "/api/auth/session",
    "/api/trips/x/history?cursor=2",
    "/s/abc",
    "/invite/tok",
    "/monitoring",
    "/monitoring?o=1&p=2",
    "/trips/123",
    "/",
    "/welcome",
    "/manifest.webmanifest",
    "/sw.js",
    "https://tiles.openfreemap.org/planet/1/2/3.pbf",
  ])("leaves %s to the network, untouched", (path) => {
    expect(worker.cacheStrategyFor(path)).toBe("network");
    expect(intercepts(path)).toBe(false);
  });

  it.each([
    "/_next/static/chunks/a.js",
    "/_next/static/css/b.css",
    "/icons/icon-192.png",
    "/icons/icon-maskable-512.png",
    "/apple-icon.png",
    "/icon.svg?c8b1d3",
  ])("serves %s cache-first", (path) => {
    expect(worker.cacheStrategyFor(path)).toBe("cache-first");
    expect(intercepts(path)).toBe(true);
  });

  it("caches nothing under /api, /s, /invite or /monitoring, whatever follows", () => {
    // `fc.webSegment()` includes "_next" and "static", so a path like
    // `/api/_next/static/x` is generated too: a prefix test that forgot its
    // leading slash would be caught here.
    const w = witness("sw never caches a token or API route");
    fc.assert(
      fc.property(
        fc.constantFrom("/api", "/s", "/invite", "/monitoring"),
        fc.array(fc.oneof(fc.webSegment(), fc.constantFrom("_next", "static", "icons")), { maxLength: 4 }),
        (prefix, segments) => {
          const path = [prefix, ...segments].join("/");
          expect(worker.cacheStrategyFor(path)).toBe("network");
          w.tick();
        },
      ),
    );
    // No guard clause: every generated case asserts, so the floor is numRuns.
    w.atLeast(100);
  });
});

// CodeRabbit, PR #366. A new worker that skips waiting activates over pages
// the old one still controls, and activation deletes the old cache — while an
// old tab may still lazy-load a chunk from it, which its deploy has since
// removed from the server. So a new version waits until every old tab closes.
describe("the service worker's lifecycle", () => {
  it("installs without skipping the wait, and activates by dropping old caches and claiming", async () => {
    const w = loadWorker();
    await dispatchLifecycle(w, "install");
    expect(w.skipWaiting).not.toHaveBeenCalled();

    await dispatchLifecycle(w, "activate");
    expect(w.deleted).toEqual(["caesura-static-v0"]);
    expect(w.claim).toHaveBeenCalledOnce();
  });
});
