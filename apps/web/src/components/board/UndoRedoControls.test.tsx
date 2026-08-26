import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UndoRedoControls, useUndoRedoShortcuts } from "./UndoRedoControls";

afterEach(cleanup);

describe("UndoRedoControls", () => {
  it("buttons reflect availability and fire callbacks", () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    render(<UndoRedoControls canUndo={true} canRedo={false} onUndo={onUndo} onRedo={onRedo} />);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onUndo).toHaveBeenCalledOnce();
    expect((screen.getByRole("button", { name: "Redo" }) as HTMLButtonElement).disabled).toBe(true);
  });

  // The shortcut lives in useUndoRedoShortcuts, not in the buttons: the
  // buttons render inside the History popover now, whose content unmounts
  // when closed, and ⌘Z has to keep working with History shut. Exercised
  // through a host that mounts ONLY the hook — if the binding ever migrates
  // back into the button component, this fails.
  it("Cmd/Ctrl+Z undoes, Shift+Cmd/Ctrl+Z redoes, typing contexts are ignored", () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    function ShortcutHost() {
      useUndoRedoShortcuts({ canUndo: true, canRedo: true, onUndo, onRedo });
      return <input aria-label="probe" />;
    }
    render(<ShortcutHost />);
    fireEvent.keyDown(window, { key: "z", metaKey: true });
    expect(onUndo).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "z", metaKey: true, shiftKey: true });
    expect(onRedo).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByLabelText("probe"), { key: "z", ctrlKey: true });
    expect(onUndo).toHaveBeenCalledTimes(1); // unchanged
  });

  it("disables both buttons while a command is in flight (isBusy)", () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    render(<UndoRedoControls canUndo={true} canRedo={true} onUndo={onUndo} onRedo={onRedo} isBusy={true} />);
    expect((screen.getByRole("button", { name: "Undo" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Redo" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("a rapid double-click while isBusy does not fire a second command", () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    const { rerender } = render(
      <UndoRedoControls canUndo={true} canRedo={true} onUndo={onUndo} onRedo={onRedo} isBusy={false} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onUndo).toHaveBeenCalledTimes(1);
    // Simulate the parent flipping isBusy true as soon as the command is dispatched.
    rerender(<UndoRedoControls canUndo={true} canRedo={true} onUndo={onUndo} onRedo={onRedo} isBusy={true} />);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onUndo).toHaveBeenCalledTimes(1); // unchanged: button was disabled
  });
});
