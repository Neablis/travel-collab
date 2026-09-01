import { describe, expect, it, vi } from "vitest";
import type { KeyboardEvent } from "react";
import { submitOnEnter } from "./submitOnEnter";

/**
 * A React `KeyboardEvent` is a synthetic wrapper, and the one field this helper
 * needs (`isComposing`) lives on the NATIVE event underneath it — so the double
 * is shaped that way rather than flattened, or the composing guard would be
 * tested against a property the real event does not have there.
 */
function keyEvent(
  key: string,
  overrides: { isComposing?: boolean; repeat?: boolean } & Partial<
    Record<"shiftKey" | "altKey" | "ctrlKey" | "metaKey", boolean>
  > = {},
): KeyboardEvent & { preventDefault: ReturnType<typeof vi.fn> } {
  return {
    key,
    repeat: overrides.repeat ?? false,
    shiftKey: overrides.shiftKey ?? false,
    altKey: overrides.altKey ?? false,
    ctrlKey: overrides.ctrlKey ?? false,
    metaKey: overrides.metaKey ?? false,
    nativeEvent: { isComposing: overrides.isComposing ?? false },
    preventDefault: vi.fn(),
  } as unknown as KeyboardEvent & { preventDefault: ReturnType<typeof vi.fn> };
}

describe("submitOnEnter", () => {
  it("runs the action on a plain Enter, and swallows the key", () => {
    const run = vi.fn();
    const event = keyEvent("Enter");
    submitOnEnter(run)(event);
    expect(run).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it("ignores every other key", () => {
    const run = vi.fn();
    for (const key of ["a", "Escape", "Tab", " ", "ArrowDown"]) {
      const event = keyEvent(key);
      submitOnEnter(run)(event);
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
    expect(run).not.toHaveBeenCalled();
  });

  it("ignores the Enter that accepts an IME candidate", () => {
    // The case that matters here specifically: this app's demo content is
    // Japanese place names, so a composing Enter is a normal keystroke, not a
    // submit. It must also not be swallowed — the IME still needs it.
    const run = vi.fn();
    const event = keyEvent("Enter", { isComposing: true });
    submitOnEnter(run)(event);
    expect(run).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("ignores a held Enter after the first press", () => {
    const run = vi.fn();
    const event = keyEvent("Enter", { repeat: true });
    submitOnEnter(run)(event);
    expect(run).not.toHaveBeenCalled();
  });

  it("ignores a modified Enter", () => {
    const run = vi.fn();
    for (const modifier of ["shiftKey", "altKey", "ctrlKey", "metaKey"] as const) {
      submitOnEnter(run)(keyEvent("Enter", { [modifier]: true }));
    }
    expect(run).not.toHaveBeenCalled();
  });
});
