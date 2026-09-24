import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PageDoc } from "@tc/contracts";
import { EDIT_SESSION_IDLE_MS, useEditSession, type CommitSession } from "./useEditSession";

// ADR-036 decision 5: one history event per editing session, and "stop
// editing" is defined rather than implied. Each trigger is its own test so a
// mutation that removes one goes red on its own name.
const doc = (text: string) =>
  ({ v: 1, type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] }) as PageDoc;

function mount(editing = true, commit = vi.fn<CommitSession>()) {
  const hook = renderHook(({ editing: e, commit: c }) => useEditSession(e, c), {
    initialProps: { editing, commit },
  });
  return { ...hook, commit };
}

describe("useEditSession", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // The whole point of dropping autosave: a pause is not the end of a session.
  it("writes nothing while the author is still editing", () => {
    const { result, commit } = mount();
    act(() => result.current.change(doc("a")));
    act(() => vi.advanceTimersByTime(EDIT_SESSION_IDLE_MS - 1));
    expect(commit).not.toHaveBeenCalled();
  });

  it("commits the latest document once, when the author leaves Editing", () => {
    const { result, rerender, commit } = mount();
    act(() => {
      result.current.change(doc("a"));
      result.current.change(doc("ab"));
    });
    rerender({ editing: false, commit });
    expect(commit.mock.calls).toEqual([[doc("ab"), { keepalive: false, overtaking: false }]]);
  });

  it("writes nothing when a session changed nothing", () => {
    const { rerender, unmount, commit } = mount();
    rerender({ editing: false, commit });
    unmount();
    window.dispatchEvent(new Event("pagehide"));
    expect(commit).not.toHaveBeenCalled();
  });

  // KI-2026-09-24-g: the debounce was CANCELLED on unmount, so client
  // navigation inside the window dropped the last edit.
  it("commits on unmount rather than dropping the edit", () => {
    const { result, unmount, commit } = mount();
    act(() => result.current.change(doc("a")));
    unmount();
    expect(commit.mock.calls).toEqual([[doc("a"), { keepalive: false, overtaking: false }]]);
  });

  // ...and a reload never unmounts at all. `keepalive` is what lets the
  // request outlive the page that sent it.
  it("commits on pagehide, with keepalive, and not again on the unmount after", () => {
    const { result, unmount, commit } = mount();
    act(() => result.current.change(doc("a")));
    window.dispatchEvent(new Event("pagehide"));
    unmount();
    expect(commit.mock.calls).toEqual([[doc("a"), { keepalive: true, overtaking: false }]]);
  });

  // Mobile Safari does not reliably fire pagehide when a tab is swiped away or
  // the app is backgrounded and killed; `visibilitychange` to hidden is the
  // last event it does fire. Safari then often fires pagehide as well, so the
  // second trigger must find nothing left to send: one session, one write.
  describe("when the page is hidden", () => {
    let visibility: DocumentVisibilityState = "visible";
    beforeEach(() => {
      visibility = "visible";
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => visibility,
      });
    });
    afterEach(() => {
      Reflect.deleteProperty(document, "visibilityState");
    });
    const setVisibility = (state: DocumentVisibilityState) => {
      visibility = state;
      document.dispatchEvent(new Event("visibilitychange"));
    };

    it("commits with keepalive, and not again on the pagehide and unmount after", () => {
      const { result, unmount, commit } = mount();
      act(() => result.current.change(doc("a")));
      setVisibility("hidden");
      expect(commit.mock.calls).toEqual([[doc("a"), { keepalive: true, overtaking: false }]]);
      window.dispatchEvent(new Event("pagehide"));
      unmount();
      expect(commit).toHaveBeenCalledTimes(1);
    });

    // The tab came back while its hidden-page write was still on the wire.
    // The next ordinary commit names the same revision that write is about to
    // move, so racing it would get one of the two refused as stale, and the
    // author would be shown a conflict with their own words (CodeRabbit, PR
    // #226). It waits instead, and goes once the keepalive has answered.
    it("holds an ordinary commit until a keepalive in flight has answered", async () => {
      let land: (ok: boolean) => void = () => {};
      const commit = vi
        .fn<CommitSession>()
        .mockImplementationOnce(() => new Promise((r) => (land = r)))
        .mockResolvedValue(true);
      const { result } = mount(true, commit);
      act(() => result.current.change(doc("a")));
      setVisibility("hidden");
      setVisibility("visible");
      act(() => result.current.change(doc("ab")));
      act(() => result.current.flush());
      expect(commit.mock.calls.map(([d]) => d)).toEqual([doc("a")]);
      await act(async () => land(true));
      expect(commit.mock.calls).toEqual([
        [doc("a"), { keepalive: true, overtaking: false }],
        [doc("ab"), { keepalive: false, overtaking: false }],
      ]);
    });

    // A second unload write cannot wait either, and the revision it would
    // name is the one the first is about to move: it overtakes the first.
    it("calls a keepalive that passes another keepalive overtaking", () => {
      const commit = vi.fn<CommitSession>().mockImplementation(() => new Promise(() => {}));
      const { result } = mount(true, commit);
      act(() => result.current.change(doc("a")));
      setVisibility("hidden");
      setVisibility("visible");
      act(() => result.current.change(doc("ab")));
      window.dispatchEvent(new Event("pagehide"));
      expect(commit.mock.calls).toEqual([
        [doc("a"), { keepalive: true, overtaking: false }],
        [doc("ab"), { keepalive: true, overtaking: true }],
      ]);
    });

    it("does not commit when the page becomes visible", () => {
      const { result, commit } = mount();
      act(() => result.current.change(doc("a")));
      setVisibility("visible");
      expect(commit).not.toHaveBeenCalled();
    });
  });

  it("commits after a minute idle, counted from the LAST change", () => {
    const { result, commit } = mount();
    act(() => result.current.change(doc("a")));
    act(() => vi.advanceTimersByTime(EDIT_SESSION_IDLE_MS / 2));
    act(() => result.current.change(doc("ab")));
    act(() => vi.advanceTimersByTime(EDIT_SESSION_IDLE_MS - 1));
    expect(commit).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(commit.mock.calls).toEqual([[doc("ab"), { keepalive: false, overtaking: false }]]);
  });

  // A document belongs to the page it was typed on. `commit` closes over the
  // page id, and a screen reused for another page must not send the first
  // page's prose to the second.
  it("commits through the commit it was typed under", () => {
    const first = vi.fn<CommitSession>();
    const second = vi.fn<CommitSession>();
    const { result, rerender, unmount } = mount(true, first);
    act(() => result.current.change(doc("a")));
    rerender({ editing: true, commit: second });
    unmount();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  // A failed write must not lose the session: with one write per session there
  // is no 800ms re-send behind it. The document stays pending, the failure is
  // reported, and the next idle retries it.
  it("keeps a document whose commit failed, reports it, and retries it on idle", async () => {
    const commit = vi.fn<CommitSession>().mockResolvedValueOnce(false).mockResolvedValue(true);
    const { result, rerender } = mount(true, commit);
    act(() => result.current.change(doc("a")));
    rerender({ editing: false, commit });
    await act(() => Promise.resolve());
    expect(result.current.failed).toBe(true);
    act(() => vi.advanceTimersByTime(EDIT_SESSION_IDLE_MS));
    await act(() => Promise.resolve());
    expect(commit.mock.calls).toEqual([
      [doc("a"), { keepalive: false, overtaking: false }],
      [doc("a"), { keepalive: false, overtaking: false }],
    ]);
    expect(result.current.failed).toBe(false);
  });

  // ...and a failure never puts an OLDER document back over a newer one typed
  // while it was in flight: every document is the whole page, so the newer one
  // already carries everything the failed one did.
  it("does not restore a failed document over a newer change", async () => {
    let fail: (ok: boolean) => void = () => {};
    const commit = vi.fn<CommitSession>().mockImplementationOnce(() => new Promise((r) => (fail = r)));
    const { result, unmount } = mount(true, commit);
    act(() => result.current.change(doc("a")));
    act(() => result.current.flush());
    act(() => result.current.change(doc("ab")));
    await act(async () => fail(false));
    unmount();
    expect(commit.mock.calls.map(([d]) => d)).toEqual([doc("a"), doc("ab")]);
  });

  // Two PATCHes in flight at once can land in either order, and the server
  // keeps whichever arrives last. So a settle made while one is in flight
  // waits for it, then sends only the newest document (CodeRabbit, PR #222).
  it("keeps one commit in flight, then sends only the newest document", async () => {
    let land: (ok: boolean) => void = () => {};
    const commit = vi
      .fn<CommitSession>()
      .mockImplementationOnce(() => new Promise((r) => (land = r)))
      .mockResolvedValue(true);
    const { result } = mount(true, commit);
    act(() => result.current.change(doc("a")));
    act(() => result.current.flush());
    act(() => result.current.change(doc("ab")));
    act(() => result.current.flush());
    act(() => result.current.change(doc("abc")));
    act(() => vi.advanceTimersByTime(EDIT_SESSION_IDLE_MS));
    expect(commit.mock.calls.map(([d]) => d)).toEqual([doc("a")]);
    await act(async () => land(true));
    expect(commit.mock.calls).toEqual([
      [doc("a"), { keepalive: false, overtaking: false }],
      [doc("abc"), { keepalive: false, overtaking: false }],
    ]);
  });

  // Waiting must not become dropping: an unmount's settle queued behind an
  // in-flight commit still goes, after the screen is gone (KI-2026-09-24-g).
  it("still sends a settle queued behind an in-flight commit when it unmounts", async () => {
    let land: (ok: boolean) => void = () => {};
    const commit = vi
      .fn<CommitSession>()
      .mockImplementationOnce(() => new Promise((r) => (land = r)))
      .mockResolvedValue(true);
    const { result, unmount } = mount(true, commit);
    act(() => result.current.change(doc("a")));
    act(() => result.current.flush());
    act(() => result.current.change(doc("ab")));
    unmount();
    await act(async () => land(true));
    expect(commit.mock.calls.map(([d]) => d)).toEqual([doc("a"), doc("ab")]);
  });

  // A commit that rejects rather than resolving `false` must not hold the
  // queue shut behind it.
  it("treats a rejected commit as failed, and still sends the next one", async () => {
    const commit = vi.fn<CommitSession>().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(true);
    const { result } = mount(true, commit);
    act(() => result.current.change(doc("a")));
    act(() => result.current.flush());
    await act(() => Promise.resolve());
    expect(result.current.failed).toBe(true);
    act(() => result.current.change(doc("ab")));
    act(() => result.current.flush());
    expect(commit.mock.calls.map(([d]) => d)).toEqual([doc("a"), doc("ab")]);
  });

  // The unload write cannot wait for anything: the page is going. `PageScreen`
  // keeps a draft of it, which is what makes firing it past the queue safe.
  // It is told it is `overtaking`: the revision it would name is about to be
  // moved by the commit it passed, so it must name none (CodeRabbit, PR #222).
  it("sends a keepalive settle at once, even with a commit in flight", () => {
    const commit = vi.fn<CommitSession>().mockImplementationOnce(() => new Promise(() => {}));
    const { result } = mount(true, commit);
    act(() => result.current.change(doc("a")));
    act(() => result.current.flush());
    act(() => result.current.change(doc("ab")));
    window.dispatchEvent(new Event("pagehide"));
    expect(commit.mock.calls).toEqual([
      [doc("a"), { keepalive: false, overtaking: false }],
      [doc("ab"), { keepalive: true, overtaking: true }],
    ]);
  });

  // ...and so an older commit CAN still answer after a newer one. Its result
  // is history: it may not report a failure, or put back a document the newer
  // commit already carried.
  it("ignores an older commit that fails after a newer one was taken", async () => {
    let land: (ok: boolean) => void = () => {};
    const commit = vi
      .fn<CommitSession>()
      .mockImplementationOnce(() => new Promise((r) => (land = r)))
      .mockResolvedValue(true);
    const { result, unmount } = mount(true, commit);
    act(() => result.current.change(doc("a")));
    act(() => result.current.flush());
    act(() => result.current.change(doc("ab")));
    window.dispatchEvent(new Event("pagehide"));
    await act(() => Promise.resolve());
    await act(async () => land(false));
    expect(result.current.failed).toBe(false);
    act(() => vi.advanceTimersByTime(EDIT_SESSION_IDLE_MS));
    unmount();
    expect(commit.mock.calls.map(([d]) => d)).toEqual([doc("a"), doc("ab")]);
  });

  // A document the server refused as typed against an older page is not a
  // failure to retry: the same send would be refused again, and it is the
  // OLDER document. Neither it nor anything typed on top of it is sent under
  // this session again; `PageScreen` has already kept and offered it.
  it("drops a superseded document and what was typed over it, without failing or retrying", async () => {
    let land: (outcome: "superseded") => void = () => {};
    const commit = vi
      .fn<CommitSession>()
      .mockImplementationOnce(() => new Promise((r) => (land = r)))
      .mockResolvedValue(true);
    const { result, unmount } = mount(true, commit);
    act(() => result.current.change(doc("a")));
    act(() => result.current.flush());
    act(() => result.current.change(doc("ab")));
    act(() => result.current.flush());
    await act(async () => land("superseded"));
    expect(result.current.failed).toBe(false);
    act(() => vi.advanceTimersByTime(EDIT_SESSION_IDLE_MS));
    unmount();
    expect(commit.mock.calls.map(([d]) => d)).toEqual([doc("a")]);
  });

  // ...but the session goes on: what is typed AFTER the refusal is typed on
  // the page as it now stands, and is sent as usual.
  it("sends a change made after a superseded commit", async () => {
    const commit = vi.fn<CommitSession>().mockResolvedValueOnce("superseded").mockResolvedValue(true);
    const { result } = mount(true, commit);
    act(() => result.current.change(doc("a")));
    act(() => result.current.flush());
    await act(() => Promise.resolve());
    act(() => result.current.change(doc("b")));
    act(() => result.current.flush());
    expect(commit.mock.calls.map(([d]) => d)).toEqual([doc("a"), doc("b")]);
  });

  it("does not call a keepalive overtaking when nothing is in flight", () => {
    const { result, commit } = mount();
    act(() => result.current.change(doc("a")));
    window.dispatchEvent(new Event("pagehide"));
    expect(commit.mock.calls).toEqual([[doc("a"), { keepalive: true, overtaking: false }]]);
  });

  it("commits on flush, the manual retry", () => {
    const { result, commit } = mount();
    act(() => result.current.change(doc("a")));
    act(() => result.current.flush());
    expect(commit.mock.calls).toEqual([[doc("a"), { keepalive: false, overtaking: false }]]);
  });
});
