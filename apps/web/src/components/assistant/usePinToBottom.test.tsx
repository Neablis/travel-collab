import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setViewportMatches } from "../../../vitest.setup";
import { usePinToBottom } from "./usePinToBottom";

afterEach(() => setViewportMatches({}));

// Pinning belongs to whoever owns the scrollport, which `Transcript` never did
// — `AssistantRail`'s `overflow-y-auto` column does, and the New-trip sheet's
// thread will. `scrollIntoView` moved every scrollable ancestor rather than the
// intended one (SPEC §30.6 bans it repo-wide; KI-2026-09-13-a was a bug in
// that family), so the job moves here and becomes explicit about its target.
//
// jsdom gives every element `scrollHeight: 0` and no layout, so these assert
// the ASSIGNMENT rather than a scroll outcome. A plain object is a better
// stand-in than a rendered node for exactly that reason: `scrollHeight` is
// writable on it, so the second rerender can prove the hook re-reads it instead
// of caching the first value.
describe("usePinToBottom", () => {
  it("pins the scrollport to its own scrollHeight when a dep changes", () => {
    // `scrollHeight` is read-only on `HTMLElement`, so the stand-in keeps its
    // own literal type and only the REF is cast. That is also what lets the
    // rerender below change it.
    const node = { scrollTop: 0, scrollHeight: 500 };
    const ref = { current: node as unknown as HTMLElement };
    const { rerender } = renderHook(({ n }) => usePinToBottom(ref, [n]), {
      initialProps: { n: 1 },
    });
    expect(node.scrollTop).toBe(500);

    node.scrollTop = 0;
    node.scrollHeight = 900;
    rerender({ n: 2 });
    expect(node.scrollTop).toBe(900);
  });

  it("leaves the scrollport alone when nothing changed", () => {
    const node = { scrollTop: 0, scrollHeight: 500 };
    const ref = { current: node as unknown as HTMLElement };
    const { rerender } = renderHook(({ n }) => usePinToBottom(ref, [n]), {
      initialProps: { n: 1 },
    });
    node.scrollTop = 120; // the reader scrolled up
    rerender({ n: 1 });
    expect(node.scrollTop).toBe(120);
  });

  it("does not throw when the scrollport is not mounted", () => {
    const ref: { current: HTMLElement | null } = { current: null };
    expect(() => renderHook(() => usePinToBottom(ref, [1]))).not.toThrow();
  });

  // A scrollport that can glide: `scrollTo` lands at once unless smooth,
  // clamped as a browser clamps it, and a smooth one is in flight until the
  // test ends it, as `scrollend` would.
  const glider = (scrollHeight: number) => {
    const ended: (() => void)[] = [];
    const node = {
      scrollTop: 0,
      scrollHeight,
      clientHeight: 300,
      onscrollend: null,
      scrollTo: vi.fn(({ top, behavior }: ScrollToOptions) => {
        if (behavior !== "smooth") node.scrollTop = Math.min(top ?? 0, node.scrollHeight - node.clientHeight);
      }),
      addEventListener: (type: string, listener: () => void) => {
        if (type === "scrollend") ended.push(listener);
      },
      removeEventListener: () => {},
    };
    const end = () => {
      node.scrollTop = node.scrollHeight - node.clientHeight;
      for (const listener of ended.splice(0)) listener();
    };
    return { node, ref: { current: node as unknown as HTMLElement }, end };
  };

  // M54 decision 13: new content glides into view rather than jumping, and
  // under reduced motion it goes there at once (spec §3). Still the
  // scrollport's own `scrollTo`, never `scrollIntoView`.
  it("glides to new content, and goes at once under reduced motion", () => {
    const { node, ref, end } = glider(500);
    const { rerender } = renderHook(({ n }) => usePinToBottom(ref, [n]), { initialProps: { n: 1 } });
    node.scrollHeight = 700;
    rerender({ n: 2 });
    expect(node.scrollTo).toHaveBeenLastCalledWith({ top: 700, behavior: "smooth" });
    end();

    setViewportMatches({ "(prefers-reduced-motion: reduce)": true });
    node.scrollHeight = 900;
    rerender({ n: 3 });
    expect(node.scrollTo).toHaveBeenLastCalledWith({ top: 900, behavior: "instant" });
  });

  // PR 605 review: opening on a loaded thread is not new content. A glide
  // from the top would scroll the reader through the whole history.
  it("opens at the bottom at once, with motion allowed", () => {
    const { node, ref } = glider(4000);
    renderHook(() => usePinToBottom(ref, [1]));
    expect(node.scrollTo).toHaveBeenLastCalledWith({ top: 4000, behavior: "instant" });
  });

  // A panel that opened while still loading has nothing to scroll yet: the
  // history landing is its first real pin, and goes at once too.
  it("goes at once to a history that lands after the open", () => {
    const { node, ref } = glider(300);
    const { rerender } = renderHook(({ n }) => usePinToBottom(ref, [n]), { initialProps: { n: 0 } });
    node.scrollHeight = 4000;
    rerender({ n: 40 });
    expect(node.scrollTo).toHaveBeenLastCalledWith({ top: 4000, behavior: "instant" });
  });

  // PR 605 review: a streamed answer changes the thread on every delta. Each
  // one restarting the glide makes the view stutter behind the text, so a
  // glide already under way is left to finish, and one more follows it to
  // wherever the bottom has moved.
  it("lets a glide already heading to the bottom finish before the next", () => {
    const { node, ref, end } = glider(500);
    const { rerender } = renderHook(({ n }) => usePinToBottom(ref, [n]), { initialProps: { n: 1 } });
    node.scrollHeight = 700;
    rerender({ n: 2 });
    const calls = node.scrollTo.mock.calls.length;
    node.scrollHeight = 720;
    rerender({ n: 3 });
    node.scrollHeight = 740;
    rerender({ n: 4 });
    expect(node.scrollTo).toHaveBeenCalledTimes(calls);

    end();
    expect(node.scrollTo).toHaveBeenCalledTimes(calls + 1);
    expect(node.scrollTo).toHaveBeenLastCalledWith({ top: 740, behavior: "smooth" });
  });
});
