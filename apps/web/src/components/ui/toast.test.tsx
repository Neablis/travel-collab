import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Toast } from "./toast";

// delay: null (Phase 4, KI-13): userEvent only schedules a real setTimeout
// when `delay` is a number, so the two click()s below no longer pay a
// wall-clock wait that a loaded machine can stretch arbitrarily.
const user = userEvent.setup({ delay: null });

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

    await user.click(screen.getByRole("button", { name: /undo/i }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("omits the action button when none is given", () => {
    render(<Toast message="Something happened" onDismiss={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /undo/i })).toBeNull();
  });

  // SPEC §27: *"The toast holds 6s when it carries an action, 2.4s when it does
  // not."* Both directions, because one flat duration satisfied either
  // assertion alone and the point is that they DIFFER — a toast you can act on
  // has to outlast the moment you realise you want to.
  it("auto-dismisses after 2.4s with nothing to act on", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<Toast message="Deleted" onDismiss={onDismiss} />);
    vi.advanceTimersByTime(2399);
    expect(onDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("holds for 6s when it carries an action", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<Toast message="Deleted" actionLabel="Undo" onAction={vi.fn()} onDismiss={onDismiss} />);
    // Past the no-action window, and still there — which is the whole claim.
    vi.advanceTimersByTime(2400);
    expect(onDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3600);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("dismisses immediately when the dismiss control is clicked", async () => {
    const onDismiss = vi.fn();
    render(<Toast message="Deleted" onDismiss={onDismiss} />);
    await user.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  // Regression test for the bug where the auto-dismiss timer depended on
  // `onDismiss`'s identity: both real call sites (page.tsx, TripHeader.tsx)
  // pass an inline arrow function as `onDismiss`, a new reference on every
  // render of the parent, which tore down and restarted the effect (and thus
  // the countdown) on any unrelated parent re-render. The earlier
  // "auto-dismisses after a timeout" test above never re-rendered its parent,
  // so it couldn't catch this.
  it("keeps its full auto-dismiss duration even when the parent re-renders with a new inline onDismiss", () => {
    vi.useFakeTimers();
    const onDismissSpy = vi.fn();

    function ParentWithRerenders() {
      const [, setTick] = useState(0);
      return (
        <div>
          <button onClick={() => setTick((t) => t + 1)}>rerender</button>
          {/* A fresh arrow function every render, exactly like the real call sites. */}
          <Toast message="Deleted" onDismiss={() => onDismissSpy()} />
        </div>
      );
    }

    render(<ParentWithRerenders />);

    // Partway through the window, force the parent (and therefore Toast) to
    // re-render with a brand-new onDismiss reference.
    vi.advanceTimersByTime(1200);
    fireEvent.click(screen.getByRole("button", { name: /rerender/i }));
    expect(onDismissSpy).not.toHaveBeenCalled();

    // Advance to the ORIGINAL total duration (2400ms since first mount — §27's
    // no-action window). Before the fix, the re-render at 1200ms would have
    // restarted the countdown and this would still be pending.
    vi.advanceTimersByTime(1200);
    expect(onDismissSpy).toHaveBeenCalledTimes(1);
  });

  // The timer is intentionally NOT fully inert to prop changes: if the same
  // Toast instance is reused for a genuinely new message without unmounting
  // (page.tsx can overwrite an in-flight toast with a second delete's message
  // before the first one closes), the new message should get its own
  // full-length countdown rather than inheriting whatever time was left.
  it("restarts the timer when the message changes on the same instance", () => {
    vi.useFakeTimers();
    const onDismissSpy = vi.fn();
    const { rerender } = render(<Toast message='Deleted "A"' onDismiss={onDismissSpy} />);

    vi.advanceTimersByTime(1800);
    rerender(<Toast message='Deleted "B"' onDismiss={onDismissSpy} />);

    // 1800ms elapsed since the new message mounted its own timer — not yet due,
    // though 3600ms have now passed since the first mount.
    vi.advanceTimersByTime(1800);
    expect(onDismissSpy).not.toHaveBeenCalled();

    // 2400ms since the message changed.
    vi.advanceTimersByTime(600);
    expect(onDismissSpy).toHaveBeenCalledTimes(1);
  });
});
