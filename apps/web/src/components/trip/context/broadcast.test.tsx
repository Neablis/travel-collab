import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { TripHistory } from "@tc/contracts";
import { headSeqOf, POLL_INTERVAL_MS, useTripBroadcast } from "./broadcast";

const fetchTripEventsMock = vi.fn();
vi.mock("@/lib/apiClient", () => ({
  fetchTripEvents: (...args: unknown[]) => fetchTripEventsMock(...args),
}));

const history = (entries: { fromSeq: number; toSeq: number }[]): TripHistory => ({
  tripId: "t",
  canUndo: false,
  canRedo: false,
  entries: entries.map((e) => ({
    ...e,
    batchId: "11111111-1111-4111-8111-111111111111",
    actorId: "a",
    occurredAt: "2026-09-22T00:00:00.000Z",
    origin: { kind: "user" as const },
    description: "d",
    undone: false,
  })),
});

const page = (over: Partial<{ headSeq: number; resync: boolean }> = {}) => ({
  ok: true as const,
  value: { headSeq: 0, events: [], resync: false, ...over },
});

// jsdom reports "visible" and has no way to set it; this is the documented
// override, and it is restored in afterEach.
function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("headSeqOf", () => {
  // The invariant the whole cursor rests on: entries are newest-first, so the
  // head is the FIRST entry's toSeq, not the last.
  it("reads the head off the newest entry", () => {
    expect(headSeqOf(history([{ fromSeq: 3, toSeq: 4 }, { fromSeq: 1, toSeq: 2 }]))).toBe(4);
  });

  // 0 is also what the events endpoint reports for a stream carrying nothing,
  // so the two agree at the empty case rather than one of them guessing.
  it("is 0 for a trip with no history", () => {
    expect(headSeqOf(history([]))).toBe(0);
  });
});

describe("useTripBroadcast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchTripEventsMock.mockReset().mockResolvedValue(page());
  });
  afterEach(() => {
    vi.useRealTimers();
    setVisibility("visible");
  });

  const mount = (over: Partial<Parameters<typeof useTripBroadcast>[0]> = {}) => {
    const onChanged = vi.fn();
    const r = renderHook(() =>
      useTripBroadcast({
        tripId: "t",
        enabled: true,
        cursor: () => 0,
        onChanged,
        ...over,
      }),
    );
    return { onChanged, ...r };
  };

  it("does not poll at all when disabled — a solo trip has no second writer", async () => {
    mount({ enabled: false });
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    expect(fetchTripEventsMock).not.toHaveBeenCalled();
  });

  it("polls on the interval while visible, sending the cursor", async () => {
    mount({ cursor: () => 7 });
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(fetchTripEventsMock).toHaveBeenCalledWith("t", 7);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(fetchTripEventsMock).toHaveBeenCalledTimes(2);
  });

  // The cursor is read at poll time rather than captured: the confirmed head
  // advances every time the user's own work lands, and a stale cursor would
  // re-report those edits as remote news on every tick.
  it("re-reads the cursor on every poll", async () => {
    let cursor = 1;
    mount({ cursor: () => cursor });
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    cursor = 9;
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(fetchTripEventsMock.mock.calls.map((c) => c[1])).toEqual([1, 9]);
  });

  it("reports a change when the head has moved past the cursor", async () => {
    fetchTripEventsMock.mockResolvedValue(page({ headSeq: 5 }));
    const { onChanged } = mount({ cursor: () => 3 });
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("says nothing when the head has not moved", async () => {
    fetchTripEventsMock.mockResolvedValue(page({ headSeq: 3 }));
    const { onChanged } = mount({ cursor: () => 3 });
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);
    expect(onChanged).not.toHaveBeenCalled();
  });

  // Both mean "your cursor is behind the head", and the caller's answer to
  // either is the same one cheap refetch.
  it("treats resync exactly like news", async () => {
    fetchTripEventsMock.mockResolvedValue(page({ headSeq: 3, resync: true }));
    const { onChanged } = mount({ cursor: () => 3 });
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  // A background read the user never asked for must not raise anything: the
  // next tick retries, and the cursor only advances on a poll that succeeded.
  it("is silent on a failed poll and keeps polling", async () => {
    fetchTripEventsMock.mockResolvedValue({ ok: false, error: { status: 500, message: "boom" } });
    const { onChanged } = mount();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);
    expect(onChanged).not.toHaveBeenCalled();
    expect(fetchTripEventsMock).toHaveBeenCalledTimes(2);
  });

  it("stops polling when the tab is hidden", async () => {
    mount();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(fetchTripEventsMock).toHaveBeenCalledTimes(1);

    setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    expect(fetchTripEventsMock).toHaveBeenCalledTimes(1);
  });

  // Returning to a tab is exactly when a stale board is most visible, so this
  // does not wait out an interval.
  it("polls immediately when the tab comes back", async () => {
    mount();
    setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);
    expect(fetchTripEventsMock).not.toHaveBeenCalled();

    setVisibility("visible");
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchTripEventsMock).toHaveBeenCalledTimes(1);
  });

  it("stops polling once unmounted", async () => {
    const { unmount } = mount();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(fetchTripEventsMock).toHaveBeenCalledTimes(1);
    unmount();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    expect(fetchTripEventsMock).toHaveBeenCalledTimes(1);
  });

  // The provider can unmount while a request is in flight; telling a dead
  // caller its trip moved is how you get a setState on an unmounted tree.
  it("does not report a change that arrives after unmount", async () => {
    let settle!: (v: unknown) => void;
    fetchTripEventsMock.mockReturnValue(new Promise((res) => (settle = res)));
    const { onChanged, unmount } = mount({ cursor: () => 0 });
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    unmount();
    settle(page({ headSeq: 99 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(onChanged).not.toHaveBeenCalled();
  });
});
