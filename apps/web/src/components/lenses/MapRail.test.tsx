import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { triggerResize } from "../../../vitest.setup";
import { MapRail } from "./MapRail";
import type { MapDay } from "./mapRailData";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const day = (over: Partial<MapDay> = {}): MapDay => ({
  index: 0, dayId: "d1", label: "Day 1", date: "2026-09-05", city: "Rochester",
  accent: "warning", stops: [], unlocatedCount: 0, totalKm: 4.2,
  bars: [{ grow: 1, color: "warning" }], flagText: null, ...over,
});

describe("MapRail", () => {
  it("renders one button per day, carrying its label and city", () => {
    render(<MapRail days={[day(), day({ index: 1, dayId: "d2", label: "Day 2", city: "Niagara Falls" })]} focusedDay={0} onFocus={vi.fn()} />);

    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(screen.getByText("Rochester")).toBeTruthy();
    expect(screen.getByText("Niagara Falls")).toBeTruthy();
  });

  it("focuses a day when its button is clicked", async () => {
    const onFocus = vi.fn();
    render(<MapRail days={[day(), day({ index: 1, dayId: "d2", label: "Day 2" })]} focusedDay={0} onFocus={onFocus} />);

    await userEvent.click(screen.getAllByRole("button")[1]!);

    expect(onFocus).toHaveBeenCalledWith(1);
  });

  it("marks the focused day without greying out the others", () => {
    render(<MapRail days={[day(), day({ index: 1, dayId: "d2", label: "Day 2" })]} focusedDay={1} onFocus={vi.fn()} />);

    const [first, second] = screen.getAllByRole("button");
    expect(second!.getAttribute("aria-current")).toBe("true");
    expect(first!.getAttribute("aria-current")).toBeNull();
    // Handoff: inactive rail days keep full-strength text — the tint and the
    // left spine are the only active-state signal.
    expect(first!.className).not.toMatch(/opacity-|text-slate\b/);
  });

  it("shows a warning flag when the day carries one", () => {
    render(<MapRail days={[day({ flagText: "No stops yet" })]} focusedDay={null} onFocus={vi.fn()} />);
    expect(screen.getByText("No stops yet")).toBeTruthy();
  });

  describe("scroll-driven focus", () => {
    const DAY_HEIGHT = 95;
    const VIEWPORT = 600;

    const manyDays = (count: number): MapDay[] =>
      Array.from({ length: count }, (_, i) =>
        day({ index: i, dayId: `d${i + 1}`, label: `Day ${i + 1}` }),
      );

    /**
     * jsdom performs no layout — every offset and rect reads 0. Install a
     * static, believable one: uniform DAY_HEIGHT buttons stacked in a
     * VIEWPORT-tall rail. This stays fixed for the life of the test, the way
     * real layout does; only the scrollTop moves.
     */
    const installLayout = (count: number) => {
      const rail = screen.getByLabelText("Days");
      const track = rail.querySelector("[data-rail-track]") as HTMLElement;
      const buttons = screen.getAllByRole("button");

      Object.defineProperty(rail, "clientHeight", { value: VIEWPORT, configurable: true });
      track.getBoundingClientRect = () => ({ top: 0, height: count * DAY_HEIGHT }) as DOMRect;
      buttons.forEach((button, i) => {
        button.getBoundingClientRect = () =>
          ({ top: i * DAY_HEIGHT, height: DAY_HEIGHT }) as DOMRect;
      });

      triggerResize();
      return rail;
    };

    const scrollTo = (rail: HTMLElement, scrollTop: number) => {
      Object.defineProperty(rail, "scrollTop", { value: scrollTop, configurable: true });
      fireEvent.scroll(rail);
    };

    it("focuses a later day as the rail scrolls, promptly and without waiting for scrolling to stop", () => {
      vi.useFakeTimers();
      const onFocus = vi.fn();
      render(<MapRail days={manyDays(14)} focusedDay={0} onFocus={onFocus} />);
      const rail = installLayout(14);

      // Half way through the geared range. The very first scroll event reacts
      // (leading-edge throttle, not a trailing debounce).
      scrollTo(rail, (13 * 240) / 2);

      expect(onFocus).toHaveBeenCalledTimes(1);
      expect(onFocus.mock.calls[0]![0]).toBeGreaterThan(0);
    });

    it("reaches every day across the full scroll range, never skipping one", () => {
      vi.useFakeTimers();
      const onFocus = vi.fn();
      render(<MapRail days={manyDays(14)} focusedDay={0} onFocus={onFocus} />);
      const rail = installLayout(14);

      const travel = 13 * 240;
      for (let i = 1; i <= 400; i++) {
        scrollTo(rail, (travel * i) / 400);
        vi.advanceTimersByTime(50);
      }

      expect(onFocus.mock.calls.map((c) => c[0])).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    });

    it("focuses the last day at the bottom of the scroll range", () => {
      vi.useFakeTimers();
      const onFocus = vi.fn();
      render(<MapRail days={manyDays(14)} focusedDay={0} onFocus={onFocus} />);
      const rail = installLayout(14);

      scrollTo(rail, 13 * 240);

      expect(onFocus).toHaveBeenLastCalledWith(13);
    });

    it("gears the scroll so one day costs scrollPxPerDay of travel", () => {
      vi.useFakeTimers();
      render(<MapRail days={manyDays(14)} focusedDay={0} onFocus={vi.fn()} />);
      const rail = installLayout(14);
      const spacer = rail.querySelector("[data-rail-spacer]") as HTMLElement;

      // viewport + (14 - 1) days * 240px each
      expect(spacer.style.height).toBe(`${VIEWPORT + 13 * 240}px`);
    });

    it("does not manufacture scroll travel when every day already fits", () => {
      vi.useFakeTimers();
      render(<MapRail days={manyDays(3)} focusedDay={0} onFocus={vi.fn()} />);
      const rail = installLayout(3);
      const spacer = rail.querySelector("[data-rail-spacer]") as HTMLElement;

      expect(spacer.style.height).toBe(`${VIEWPORT}px`);
    });

    it("coalesces a burst of scroll events instead of firing for every one", () => {
      vi.useFakeTimers();
      const onFocus = vi.fn();
      render(<MapRail days={manyDays(14)} focusedDay={0} onFocus={onFocus} />);
      const rail = installLayout(14);

      scrollTo(rail, 300);
      expect(onFocus).toHaveBeenCalledTimes(1);

      scrollTo(rail, 700);
      scrollTo(rail, 1100);
      scrollTo(rail, 1500);
      expect(onFocus).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(50);
      expect(onFocus).toHaveBeenCalledTimes(2);
    });

    it("does not re-emit the same day while it stays focused", () => {
      vi.useFakeTimers();
      const onFocus = vi.fn();
      render(<MapRail days={manyDays(14)} focusedDay={0} onFocus={onFocus} />);
      const rail = installLayout(14);

      // 1560 (= 6.5 * scrollPxPerDay) sits exactly on the tie boundary between
      // day 6 and day 7's centers for this geometry — a coincidence of the
      // exact constants here, not a meaningful scroll position — so this uses
      // 1550/1552 instead, comfortably inside a single day's zone, to test
      // what the name says: a small in-zone scroll delta must not re-emit.
      scrollTo(rail, 1550);
      vi.advanceTimersByTime(300);
      const callsAfterFirst = onFocus.mock.calls.length;

      scrollTo(rail, 1552);
      vi.advanceTimersByTime(300);

      expect(onFocus).toHaveBeenCalledTimes(callsAfterFirst);
    });

    it("does not call onFocus just from mounting — only an actual scroll can", () => {
      vi.useFakeTimers();
      const onFocus = vi.fn();
      render(<MapRail days={manyDays(14)} focusedDay={0} onFocus={onFocus} />);

      installLayout(14);
      vi.advanceTimersByTime(500);

      expect(onFocus).not.toHaveBeenCalled();
    });
  });
});
