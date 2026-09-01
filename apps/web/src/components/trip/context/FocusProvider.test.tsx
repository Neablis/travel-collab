import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FocusProvider,
  useDaySync,
  useFocus,
  useFollowFocusedDay,
  type DayContainer,
  type DaySync,
} from "./FocusProvider";

function Probe() {
  const { focusedDay, setFocusedDay } = useFocus();
  return <button onClick={() => setFocusedDay(2)}>focus:{String(focusedDay)}</button>;
}

describe("FocusProvider", () => {
  it("defaults to null and updates on set", async () => {
    render(<FocusProvider><Probe /></FocusProvider>);
    expect(screen.getByText("focus:null")).not.toBeNull();
    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByText("focus:2")).not.toBeNull();
  });
  it("throws when used outside the provider", () => {
    expect(() => render(<Probe />)).toThrow(/useFocus outside/);
  });
});

// M18b — SPEC §11's tag focus. Held here beside the day focus, above the lens
// switch, so it survives a lens change by construction.
function TagProbe() {
  const { focusedDay, setFocusedDay, focusedTag, toggleFocusedTag, clearFocusedTag } = useFocus();
  return (
    <div>
      <output>tag:{String(focusedTag)} day:{String(focusedDay)}</output>
      <button onClick={() => toggleFocusedTag("meal")}>meal</button>
      <button onClick={() => toggleFocusedTag("lodging")}>lodging</button>
      <button onClick={clearFocusedTag}>clear</button>
      <button onClick={() => setFocusedDay(3)}>day 3</button>
    </div>
  );
}

describe("FocusProvider tag focus", () => {
  it("starts with no tag focused", () => {
    render(<FocusProvider><TagProbe /></FocusProvider>);
    expect(screen.getByText(/tag:null/)).not.toBeNull();
  });

  it("focuses a tag, and clears it when the same tag is toggled again", async () => {
    render(<FocusProvider><TagProbe /></FocusProvider>);
    await userEvent.click(screen.getByRole("button", { name: "meal" }));
    expect(screen.getByText(/tag:meal/)).not.toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "meal" }));
    expect(screen.getByText(/tag:null/)).not.toBeNull();
  });

  // "Single focus, one tag at a time" (SPEC §11) — a second tag REPLACES the
  // first rather than joining it. Multi-select is explicitly out of scope.
  it("replaces the focused tag when a different one is toggled", async () => {
    render(<FocusProvider><TagProbe /></FocusProvider>);
    await userEvent.click(screen.getByRole("button", { name: "meal" }));
    await userEvent.click(screen.getByRole("button", { name: "lodging" }));
    expect(screen.getByText(/tag:lodging/)).not.toBeNull();
  });

  it("clears on demand — the Clear beside the view tabs", async () => {
    render(<FocusProvider><TagProbe /></FocusProvider>);
    await userEvent.click(screen.getByRole("button", { name: "meal" }));
    await userEvent.click(screen.getByRole("button", { name: "clear" }));
    expect(screen.getByText(/tag:null/)).not.toBeNull();
  });

  // The exit gate's "not confused with day focus" box, at the state layer:
  // picking a day must not silently drop a tag the viewer never cleared, and
  // vice versa.
  it("keeps day focus and tag focus independent of each other", async () => {
    render(<FocusProvider><TagProbe /></FocusProvider>);
    await userEvent.click(screen.getByRole("button", { name: "meal" }));
    await userEvent.click(screen.getByRole("button", { name: "day 3" }));
    expect(screen.getByText(/tag:meal day:3/)).not.toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "clear" }));
    expect(screen.getByText(/tag:null day:3/)).not.toBeNull();
  });
});


// ── The day-sync contract (see FocusProvider's header) ───────────────────────
//
// The jsdom lane has no layout, so nothing here can prove a scroll spy picks
// the right day — that arithmetic is pure and tested in `centralDay.test.ts`,
// and the wiring is proved in a real browser (`e2e/m10-growth.spec.ts`). What
// IS testable here is the part that has no geometry in it at all: who the
// selection came from, and whether a container can be made to read its own
// programmatic scroll back as the user's. That loop is the whole reason the
// jump lock exists, so it gets a test rather than a comment.

/**
 * A stand-in for a day element, since jsdom has neither `scrollIntoView` nor a
 * scroll offset that ever changes.
 *
 * `moves` is what makes it a *useful* stand-in: `jumpTo` decides whether to
 * keep the lock by comparing scroll offsets across the call, so a target that
 * reports no movement is the "the day was already in view" case and one that
 * reports movement is the real jump. Both are exercised below.
 */
function scrollTarget({ moves = true }: { moves?: boolean } = {}): {
  element: Element;
  calls: ScrollIntoViewOptions[];
} {
  const element = document.createElement("div");
  const calls: ScrollIntoViewOptions[] = [];
  let offset = 0;
  Object.defineProperty(element, "scrollTop", { get: () => offset, configurable: true });
  element.scrollIntoView = ((options?: ScrollIntoViewOptions) => {
    calls.push(options ?? {});
    if (moves) offset += 10;
  }) as Element["scrollIntoView"];
  return { element, calls };
}

function SyncProbe({ container, target }: { container: DayContainer; target?: Element }) {
  const { focusedDay, focusOrigin, focusSource, setFocusedDay } = useFocus();
  const sync = useDaySync(container);
  return (
    <div>
      <output>
        day:{String(focusedDay)} origin:{focusOrigin} source:{String(focusSource)} follow:
        {String(sync.shouldFollow)}
      </output>
      <button onClick={() => setFocusedDay(2)}>pick 2</button>
      <button onClick={() => sync.reportScrolled(3)}>report 3</button>
      <button onClick={() => sync.reportScrolled(4)}>report 4</button>
      <button onClick={() => sync.jumpTo(target)}>jump</button>
    </div>
  );
}

describe("FocusProvider — where the selection came from", () => {
  it("records the container that scrolled, and reads back as a scroll", async () => {
    render(
      <FocusProvider>
        <SyncProbe container="chips" />
      </FocusProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "report 3" }));
    expect(screen.getByText(/day:3 origin:scroll source:chips/)).not.toBeNull();
  });

  it("clears the source when a day is picked rather than scrolled to", async () => {
    render(
      <FocusProvider>
        <SyncProbe container="chips" />
      </FocusProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "report 3" }));
    await userEvent.click(screen.getByRole("button", { name: "pick 2" }));
    expect(screen.getByText(/day:2 origin:explicit source:null/)).not.toBeNull();
  });

  // Contract clause 2 in one assertion: the container that scrolled does not
  // scroll itself back, every other one does.
  it("tells the scrolling container not to follow, and every other one to", async () => {
    render(
      <FocusProvider>
        <SyncProbe container="chips" />
        <SyncProbe container="columns" />
      </FocusProvider>,
    );
    await userEvent.click(screen.getAllByRole("button", { name: "report 3" })[0]!);
    const [chips, columns] = screen.getAllByText(/day:3/);
    expect(chips!.textContent).toMatch(/source:chips follow:false/);
    expect(columns!.textContent).toMatch(/source:chips follow:true/);
  });
});

describe("FocusProvider — the jump lock", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ignores a container's own scroll while its jump is in flight, and listens again after", () => {
    vi.useFakeTimers();
    const { element } = scrollTarget();
    render(
      <FocusProvider>
        <SyncProbe container="chips" target={element} />
      </FocusProvider>,
    );

    // The loop this prevents: a jump scrolls the row, the row's scroll handler
    // fires, and without the lock that scroll is read as the user moving away
    // from the day we just jumped to.
    // Asserted through what the lock is FOR rather than through a flag: it
    // lives in a ref, so holding it renders nothing.
    fireEvent.click(screen.getByRole("button", { name: "jump" }));
    fireEvent.click(screen.getByRole("button", { name: "report 3" }));
    expect(screen.getByText(/day:null/)).not.toBeNull();

    // A deadline, not a boolean plus a timer — so it lapses on its own with
    // nothing to cancel. 400ms is past DAY_JUMP_LOCK_MS's 300.
    act(() => {
      vi.advanceTimersByTime(400);
    });
    fireEvent.click(screen.getByRole("button", { name: "report 4" }));
    expect(screen.getByText(/day:4 origin:scroll source:chips/)).not.toBeNull();
  });

  it("locks only the container that jumped, so the others keep driving", () => {
    vi.useFakeTimers();
    const { element } = scrollTarget();
    render(
      <FocusProvider>
        <SyncProbe container="chips" target={element} />
        <SyncProbe container="columns" />
      </FocusProvider>,
    );
    // A single global flag would deafen the chips row's OWN spy the moment the
    // columns followed it, freezing the selection one frame into a drag —
    // clause 1 broken to satisfy clause 2.
    fireEvent.click(screen.getAllByRole("button", { name: "jump" })[0]!);
    fireEvent.click(screen.getAllByRole("button", { name: "report 3" })[1]!);
    expect(screen.getByText(/day:3 origin:scroll source:columns follow:true/)).not.toBeNull();
  });

  it("does not claim a lock when there was nothing to scroll", () => {
    // No `scrollIntoView` on the target at all (jsdom's own state): there was
    // no element to scroll, so nothing to ignore either.
    render(
      <FocusProvider>
        <SyncProbe container="chips" target={document.createElement("div")} />
      </FocusProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "jump" }));
    fireEvent.click(screen.getByRole("button", { name: "report 3" }));
    expect(screen.getByText(/day:3 origin:scroll source:chips/)).not.toBeNull();
  });

  it("drops the lock at once when the day was already in view", () => {
    // The commonest jump that moves nothing is a container's first-run follow
    // on arrival (clause 3). Holding a dead lock there would discard the first
    // 300ms of the user's next flick — the exact gesture this whole change is
    // about — so the lock is released as soon as the offsets say nothing moved.
    const { element } = scrollTarget({ moves: false });
    render(
      <FocusProvider>
        <SyncProbe container="chips" target={element} />
      </FocusProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "jump" }));
    fireEvent.click(screen.getByRole("button", { name: "report 3" }));
    expect(screen.getByText(/day:3 origin:scroll source:chips/)).not.toBeNull();
  });
});

function FollowProbe({
  sync,
  focusedDay,
  target,
}: {
  sync: DaySync;
  focusedDay: number | null;
  target: Element;
}) {
  useFollowFocusedDay(sync, focusedDay, 5, () => target);
  return null;
}

describe("useFollowFocusedDay", () => {
  function stubSync(shouldFollow: boolean, jumps: number[]): DaySync {
    return {
      shouldFollow,
      isOwnScroll: () => false,
      reportScrolled: () => {},
      jumpTo: () => {
        jumps.push(jumps.length);
        return true;
      },
    };
  }

  // Contract clause 3: a lens that has just been switched to has never scrolled
  // itself, so it jumps to whatever day was already selected — even though the
  // last thing that moved the selection was this same container's own scroll.
  it("always jumps on its first run, whatever the selection's source", () => {
    const jumps: number[] = [];
    const { element } = scrollTarget();
    render(<FollowProbe sync={stubSync(false, jumps)} focusedDay={2} target={element} />);
    expect(jumps).toHaveLength(1);
  });

  // The mount exception is spent on mounting, not on the first jump. A
  // container that arrives with nothing selected must NOT then scroll itself to
  // the first day its own scrolling picks: on the timeline that pulls the
  // window back to the day you just scrolled past and takes the jump lock with
  // it, which is a real regression this caught (see `useFollowFocusedDay`).
  it("spends its exception on mounting, not on the first day it selects itself", () => {
    const jumps: number[] = [];
    const { element } = scrollTarget();
    const { rerender } = render(
      <FollowProbe sync={stubSync(false, jumps)} focusedDay={null} target={element} />,
    );
    expect(jumps).toHaveLength(0);
    rerender(<FollowProbe sync={stubSync(false, jumps)} focusedDay={2} target={element} />);
    expect(jumps).toHaveLength(0);
  });

  it("does not jump again for a selection this container's own scroll produced", () => {
    const jumps: number[] = [];
    const { element } = scrollTarget();
    const { rerender } = render(
      <FollowProbe sync={stubSync(false, jumps)} focusedDay={2} target={element} />,
    );
    rerender(<FollowProbe sync={stubSync(false, jumps)} focusedDay={3} target={element} />);
    expect(jumps).toHaveLength(1);
  });

  it("jumps for a selection made anywhere else", () => {
    const jumps: number[] = [];
    const { element } = scrollTarget();
    const { rerender } = render(
      <FollowProbe sync={stubSync(false, jumps)} focusedDay={2} target={element} />,
    );
    rerender(<FollowProbe sync={stubSync(true, jumps)} focusedDay={3} target={element} />);
    expect(jumps).toHaveLength(2);
  });

  it("stays put when nothing is selected", () => {
    const jumps: number[] = [];
    const { element } = scrollTarget();
    render(<FollowProbe sync={stubSync(true, jumps)} focusedDay={null} target={element} />);
    expect(jumps).toHaveLength(0);
  });
});
