import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSlowLoad } from "./useSlowLoad";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// Mirrors how `TripBoardScreen` uses it: the hook decides whether the loading
// branch renders words at all, so "said nothing" is an empty string here for
// the same reason it is a `null` child there.
function Probe({ loading }: { loading: boolean }) {
  const slow = useSlowLoad(loading);
  return <div data-testid="probe">{slow ? "Loading…" : ""}</div>;
}

describe("useSlowLoad", () => {
  // The boundary is pinned from both sides, `toast.test.tsx`'s idiom: a single
  // `advanceTimersByTime(200)` passes just as well against a hook that fires
  // at 1ms, which is the flicker this exists to stop.
  it("says nothing for the first 200ms, then says it", () => {
    vi.useFakeTimers();
    render(<Probe loading />);

    expect(screen.getByTestId("probe").textContent).toBe("");
    act(() => void vi.advanceTimersByTime(199));
    expect(screen.getByTestId("probe").textContent).toBe("");
    act(() => void vi.advanceTimersByTime(1));
    expect(screen.getByTestId("probe").textContent).toBe("Loading…");
  });

  // **This is Mitchell's bug.** A trip whose `TripDetail` Home already cached
  // settles in about a frame; before the gate, that frame painted `Loading…`
  // in the top-left and took it away again too fast to click.
  it("never says anything at all when the load lands inside the window", () => {
    vi.useFakeTimers();
    const { rerender } = render(<Probe loading />);

    act(() => void vi.advanceTimersByTime(16));
    rerender(<Probe loading={false} />);
    act(() => void vi.advanceTimersByTime(10_000));

    expect(screen.getByTestId("probe").textContent).toBe("");
  });

  // The cleanup branch, which a hook that only ever set `true` would pass the
  // two above and fail here: a board that loads, arrives, then loads again
  // (a retry, or a trip switched under the same mount) must get a fresh 200ms
  // rather than inherit the last spell's `true` and flash immediately.
  it("gives a second load its own window instead of inheriting the first's", () => {
    vi.useFakeTimers();
    const { rerender } = render(<Probe loading />);

    act(() => void vi.advanceTimersByTime(200));
    expect(screen.getByTestId("probe").textContent).toBe("Loading…");

    rerender(<Probe loading={false} />);
    expect(screen.getByTestId("probe").textContent).toBe("");

    rerender(<Probe loading />);
    expect(screen.getByTestId("probe").textContent).toBe("");
    act(() => void vi.advanceTimersByTime(199));
    expect(screen.getByTestId("probe").textContent).toBe("");
  });
});
