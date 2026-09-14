import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEDUPE, cachedRead, clearQueryCache, invalidate } from "@/lib/queryCache";
import { tripKeys } from "@/lib/queryKeys";
import type { ApiResult } from "@/lib/apiClient";

const TRIP = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

/** A reader that counts its calls, so "did this hit the network" is assertable. */
function reader<T>(value: T) {
  const calls = { count: 0 };
  const read = (): Promise<ApiResult<T>> => {
    calls.count += 1;
    return Promise.resolve({ ok: true, value });
  };
  return { read, calls };
}

/** A reader that resolves only when you tell it to — for the in-flight cases. */
function deferredReader<T>(value: T) {
  const calls = { count: 0 };
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const read = async (): Promise<ApiResult<T>> => {
    calls.count += 1;
    await gate;
    return { ok: true, value };
  };
  return { read, calls, release: () => release() };
}

beforeEach(() => {
  clearQueryCache();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  clearQueryCache();
});

describe("cachedRead", () => {
  it("reuses a stored result inside the window instead of reading again", async () => {
    const { read, calls } = reader({ name: "Japan" });

    const first = await cachedRead(tripKeys.detail(TRIP), read);
    const second = await cachedRead(tripKeys.detail(TRIP), read);

    expect(calls.count).toBe(1);
    expect(first).toEqual({ ok: true, value: { name: "Japan" } });
    expect(second).toEqual(first);
  });

  it("reads again once the window has passed", async () => {
    const { read, calls } = reader({ name: "Japan" });

    await cachedRead(tripKeys.detail(TRIP), read, { dedupeMs: DEDUPE.NAVIGATION });
    vi.advanceTimersByTime(DEDUPE.NAVIGATION + 1);
    await cachedRead(tripKeys.detail(TRIP), read, { dedupeMs: DEDUPE.NAVIGATION });

    expect(calls.count).toBe(2);
  });

  it("joins an identical read already in flight rather than duplicating it", async () => {
    const { read, calls, release } = deferredReader({ name: "Japan" });

    const a = cachedRead(tripKeys.detail(TRIP), read);
    const b = cachedRead(tripKeys.detail(TRIP), read);
    release();

    expect(await a).toEqual(await b);
    expect(calls.count).toBe(1);
  });

  it("keys are per-resource — one trip's detail is not another's", async () => {
    const one = reader({ name: "Japan" });
    const two = reader({ name: "Peru" });

    const a = await cachedRead(tripKeys.detail(TRIP), one.read);
    const b = await cachedRead(tripKeys.detail(OTHER), two.read);

    expect(a).toEqual({ ok: true, value: { name: "Japan" } });
    expect(b).toEqual({ ok: true, value: { name: "Peru" } });
  });

  // The retry trap: a cached `ok: false` makes "Try again" a no-op for the
  // rest of the window, which is worse than the failure it caches.
  it("never stores a failure, so an immediate retry really retries", async () => {
    const calls = { count: 0 };
    const read = async (): Promise<ApiResult<{ name: string }>> => {
      calls.count += 1;
      return calls.count === 1
        ? { ok: false, error: { status: 500, message: "boom" } }
        : { ok: true, value: { name: "Japan" } };
    };

    const failed = await cachedRead(tripKeys.detail(TRIP), read);
    const retried = await cachedRead(tripKeys.detail(TRIP), read);

    expect(failed.ok).toBe(false);
    expect(retried).toEqual({ ok: true, value: { name: "Japan" } });
    expect(calls.count).toBe(2);
  });

  it("resolves rather than rejects when the reader throws", async () => {
    const result = await cachedRead(tripKeys.detail(TRIP), () => {
      throw new Error("offline");
    });

    expect(result).toEqual({ ok: false, error: { status: 0, message: "offline" } });
  });
});

describe("invalidate", () => {
  it("drops every key under the prefix in one call", async () => {
    const detail = reader({ name: "Japan" });
    const pages = reader({ pages: [] });
    await cachedRead(tripKeys.detail(TRIP), detail.read);
    await cachedRead(tripKeys.pages(TRIP), pages.read);

    invalidate(tripKeys.all(TRIP));

    await cachedRead(tripKeys.detail(TRIP), detail.read);
    await cachedRead(tripKeys.pages(TRIP), pages.read);
    expect(detail.calls.count).toBe(2);
    expect(pages.calls.count).toBe(2);
  });

  it("leaves another trip's cache alone", async () => {
    const mine = reader({ name: "Japan" });
    const theirs = reader({ name: "Peru" });
    await cachedRead(tripKeys.detail(TRIP), mine.read);
    await cachedRead(tripKeys.detail(OTHER), theirs.read);

    invalidate(tripKeys.all(TRIP));

    await cachedRead(tripKeys.detail(TRIP), mine.read);
    await cachedRead(tripKeys.detail(OTHER), theirs.read);
    expect(mine.calls.count).toBe(2);
    expect(theirs.calls.count).toBe(1);
  });

  // The race the generation counter exists for. Without it, the pre-command
  // read lands after the write and is cached, and the next mount inside the
  // window serves a board that has silently reverted the edit.
  // CodeRabbit, PR #175: stopping the stale read from STORING was only half of
  // it. The promise stayed in `inFlight`, so a read starting after the write
  // JOINED the pre-write request and got its answer directly — the cache never
  // had to be involved. Invalidation has to detach, not just mark.
  it("a read starting after a write does not join the pre-write request still in flight", async () => {
    const stale = deferredReader({ name: "before the command" });
    const fresh = reader({ name: "after the command" });

    const pending = cachedRead(tripKeys.detail(TRIP), stale.read);
    invalidate(tripKeys.all(TRIP)); // the command lands mid-read
    // Starts while the pre-write read is STILL pending — this is the case the
    // first version of this suite stepped over by awaiting the stale read first.
    const after = cachedRead(tripKeys.detail(TRIP), fresh.read);
    stale.release();

    expect(await after).toEqual({ ok: true, value: { name: "after the command" } });
    expect(fresh.calls.count).toBe(1);
    await pending;
  });

  // The `finally` guard, which the two cases above do not reach. Once
  // invalidation DETACHES, a superseded request can still finish afterwards —
  // and if its cleanup deleted the slot unconditionally it would evict the
  // newer read that replaced it. Nothing breaks visibly; the cache just stops
  // de-duplicating, and every later reader starts its own request.
  it("a detached request finishing late does not evict the read that replaced it", async () => {
    const stale = deferredReader({ name: "before the command" });
    const fresh = deferredReader({ name: "after the command" });

    const pending = cachedRead(tripKeys.detail(TRIP), stale.read);
    invalidate(tripKeys.all(TRIP));
    const replacement = cachedRead(tripKeys.detail(TRIP), fresh.read);
    stale.release(); // the detached request lands while `replacement` is still open
    await pending;

    // A third reader arriving now must JOIN `replacement`, not start a second
    // request — which it can only do if `replacement` still holds the slot.
    const joiner = cachedRead(tripKeys.detail(TRIP), fresh.read);
    fresh.release();

    expect(await joiner).toEqual({ ok: true, value: { name: "after the command" } });
    expect(fresh.calls.count).toBe(1);
    await replacement;
  });

  // CodeRabbit, PR #175: `clearQueryCache` reset the per-key generation counter
  // to zero, and a read that started before the clear had captured zero — so it
  // compared equal and repopulated the cache it was supposed to have been
  // flushed out of. `resetDemoData` is the live caller: it deletes every trip
  // the account has, and this let a deleted one come straight back.
  it("a read that was in flight when the cache was cleared does not repopulate it", async () => {
    const stale = deferredReader({ name: "before the reset" });
    const fresh = reader({ name: "after the reset" });

    const pending = cachedRead(tripKeys.detail(TRIP), stale.read);
    clearQueryCache();
    stale.release();
    await pending;

    const next = await cachedRead(tripKeys.detail(TRIP), fresh.read);
    expect(next).toEqual({ ok: true, value: { name: "after the reset" } });
    expect(fresh.calls.count).toBe(1);
  });

  it("stops a read that was already in flight from storing its stale answer", async () => {
    const stale = deferredReader({ name: "before the command" });
    const fresh = reader({ name: "after the command" });

    const inFlight = cachedRead(tripKeys.detail(TRIP), stale.read);
    invalidate(tripKeys.all(TRIP)); // the command lands mid-read
    stale.release();
    await inFlight;

    const next = await cachedRead(tripKeys.detail(TRIP), fresh.read);
    expect(next).toEqual({ ok: true, value: { name: "after the command" } });
    expect(fresh.calls.count).toBe(1);
  });
});
