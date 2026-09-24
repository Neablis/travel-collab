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
    expect(commit.mock.calls).toEqual([[doc("ab"), { keepalive: false }]]);
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
    expect(commit.mock.calls).toEqual([[doc("a"), { keepalive: false }]]);
  });

  // ...and a reload never unmounts at all. `keepalive` is what lets the
  // request outlive the page that sent it.
  it("commits on pagehide, with keepalive, and not again on the unmount after", () => {
    const { result, unmount, commit } = mount();
    act(() => result.current.change(doc("a")));
    window.dispatchEvent(new Event("pagehide"));
    unmount();
    expect(commit.mock.calls).toEqual([[doc("a"), { keepalive: true }]]);
  });

  it("commits after a minute idle, counted from the LAST change", () => {
    const { result, commit } = mount();
    act(() => result.current.change(doc("a")));
    act(() => vi.advanceTimersByTime(EDIT_SESSION_IDLE_MS / 2));
    act(() => result.current.change(doc("ab")));
    act(() => vi.advanceTimersByTime(EDIT_SESSION_IDLE_MS - 1));
    expect(commit).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(commit.mock.calls).toEqual([[doc("ab"), { keepalive: false }]]);
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

  it("drops a discarded document on every trigger", () => {
    const { result, unmount, commit } = mount();
    act(() => {
      result.current.change(doc("a"));
      result.current.discard();
    });
    act(() => vi.advanceTimersByTime(EDIT_SESSION_IDLE_MS));
    window.dispatchEvent(new Event("pagehide"));
    unmount();
    expect(commit).not.toHaveBeenCalled();
  });
});
