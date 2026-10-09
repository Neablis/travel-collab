import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

// Run against `public/sw.js` itself — the bytes the browser installs — in a
// sandbox with a stand-in `self`, so there is no second copy to drift from the
// one that ships.

type LifecycleEvent = { waitUntil: (work: Promise<unknown>) => void };

/** Evaluates the worker script and hands back the listeners it registered. */
function loadWorker() {
  const listeners = new Map<string, (event: LifecycleEvent) => void>();
  const skipWaiting = vi.fn();
  const claim = vi.fn(async () => undefined);
  const self = {
    addEventListener: (type: string, listener: (event: LifecycleEvent) => void) => listeners.set(type, listener),
    skipWaiting,
    clients: { claim },
  };
  const deleted: string[] = [];
  const caches = {
    keys: async () => ["caesura-static-v0", "caesura-static-v1", "someone-elses-cache"],
    delete: async (key: string) => deleted.push(key),
  };
  const sandbox = vm.createContext({ self, URL, caches });
  vm.runInContext(readFileSync(join(process.cwd(), "public/sw.js"), "utf8"), sandbox);
  return { listeners, skipWaiting, claim, deleted };
}

/** Runs `type`'s listener, if the worker has one, and waits for its work. */
async function dispatchLifecycle(w: ReturnType<typeof loadWorker>, type: "install" | "activate"): Promise<void> {
  const work: Promise<unknown>[] = [];
  const event: LifecycleEvent = { waitUntil: (p) => work.push(p) };
  w.listeners.get(type)?.(event);
  await Promise.all(work);
}

// KI-2026-10-09-e. A fetch listener puts the worker in the path of every
// request, even the ones it declines without `respondWith` — and the unload
// flush lost edits there. So the guarantee is that there is no listener at all,
// not that some route is left alone.
describe("the service worker's request path", () => {
  it("registers no fetch listener, so no request ever goes through it", () => {
    const { listeners } = loadWorker();
    expect([...listeners.keys()].sort()).toEqual(["activate", "install"]);
  });
});

// A worker that waits for every old page to close never updates an installed
// standalone window, which is rarely closed — and this worker's whole job is to
// replace one with a fetch listener in windows already open.
describe("the service worker's lifecycle", () => {
  it("installs by skipping the wait, and activates by dropping its old caches and claiming", async () => {
    const w = loadWorker();
    await dispatchLifecycle(w, "install");
    expect(w.skipWaiting).toHaveBeenCalledOnce();

    await dispatchLifecycle(w, "activate");
    expect(w.deleted).toEqual(["caesura-static-v0", "caesura-static-v1"]);
    expect(w.claim).toHaveBeenCalledOnce();
  });
});
