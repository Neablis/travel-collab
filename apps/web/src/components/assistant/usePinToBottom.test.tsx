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

  // M54 decision 13: the list glides to the bottom rather than jumping, and
  // under reduced motion it goes there at once (spec §3). Still the
  // scrollport's own `scrollTo`, never `scrollIntoView`.
  it("glides to the bottom, and goes at once under reduced motion", () => {
    const scrollTo = vi.fn();
    const node = { scrollTop: 0, scrollHeight: 500, scrollTo };
    const ref = { current: node as unknown as HTMLElement };
    const { rerender } = renderHook(({ n }) => usePinToBottom(ref, [n]), { initialProps: { n: 1 } });
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 500, behavior: "smooth" });

    setViewportMatches({ "(prefers-reduced-motion: reduce)": true });
    rerender({ n: 2 });
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 500, behavior: "instant" });
  });
});
