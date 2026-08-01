import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Toast } from "./toast";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Toast", () => {
  it("is a status region showing the message, with an optional action", async () => {
    const onAction = vi.fn();
    const onDismiss = vi.fn();
    render(<Toast message='Deleted "Japan"' actionLabel="Undo" onAction={onAction} onDismiss={onDismiss} />);

    const toast = screen.getByRole("status");
    expect(toast.textContent).toMatch(/deleted "japan"/i);

    await userEvent.click(screen.getByRole("button", { name: /undo/i }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("omits the action button when none is given", () => {
    render(<Toast message="Something happened" onDismiss={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /undo/i })).toBeNull();
  });

  it("auto-dismisses after a timeout", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<Toast message="Deleted" onDismiss={onDismiss} />);
    expect(onDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(8000);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("dismisses immediately when the dismiss control is clicked", async () => {
    const onDismiss = vi.fn();
    render(<Toast message="Deleted" onDismiss={onDismiss} />);
    await userEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
