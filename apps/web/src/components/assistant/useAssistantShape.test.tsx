import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SHAPE, useAssistantShape } from "./useAssistantShape";

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

// SPEC §9, M26 link 10a: "One panel, three presentations, and the user picks."
// All three geometries were built and nobody could choose between them.
describe("useAssistantShape", () => {
  it("opens in the surface's own default before anyone picks", () => {
    expect(DEFAULT_SHAPE.board).toBe("docked");
    expect(DEFAULT_SHAPE.notebook).toBe("floating");
    const { result } = renderHook(() => useAssistantShape("board"));
    expect(result.current[0]).toBe("docked");
  });

  it("remembers the choice across a remount — which is what a reload is", () => {
    const first = renderHook(() => useAssistantShape("board"));
    act(() => first.result.current[1]("floating"));
    expect(first.result.current[0]).toBe("floating");
    first.unmount();

    const second = renderHook(() => useAssistantShape("board"));
    expect(second.result.current[0]).toBe("floating");
  });

  // **The surfaces do not share a key**, which is the whole reason this is
  // per-surface: one global setting would make docking the board silently
  // change the notebook too.
  // **The assertion is a FRESH board hook read after the notebook wrote**,
  // which is the only arrangement that can tell one key from two. The first
  // version of this test rerendered the board's existing hook instead — its
  // state was already "floating" in memory, `rerender` does not re-run the
  // mount effect, and the notebook's own default happens to be "floating" too,
  // so every assertion passed with both surfaces sharing one key. It was
  // watched to pass against exactly that break (CLAUDE.md rule 3) and replaced.
  it("keeps the two surfaces apart", () => {
    const board = renderHook(() => useAssistantShape("board"));
    act(() => board.result.current[1]("floating"));
    const notebook = renderHook(() => useAssistantShape("notebook"));
    act(() => notebook.result.current[1]("docked"));

    // Each surface reads back its OWN last choice, and they are opposites.
    expect(renderHook(() => useAssistantShape("board")).result.current[0]).toBe("floating");
    expect(renderHook(() => useAssistantShape("notebook")).result.current[0]).toBe("docked");
  });

  it("ignores a stored value that is not a shape", () => {
    window.localStorage.setItem("assistant:shape:board", "sideways");
    expect(renderHook(() => useAssistantShape("board")).result.current[0]).toBe("docked");
  });

  // **A choice that cannot be remembered is still a choice that applies now.**
  // Safari's private mode throws on `localStorage`; refusing to switch there
  // would make the control dead in exactly the browsers that need it least.
  it("still switches when storage throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const { result } = renderHook(() => useAssistantShape("board"));
    act(() => result.current[1]("floating"));
    expect(result.current[0]).toBe("floating");
  });

  it("falls back to the default when reading storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(renderHook(() => useAssistantShape("board")).result.current[0]).toBe("docked");
  });
});
