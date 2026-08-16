import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { triggerIntersection } from "../../../vitest.setup";
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
    it("focuses the most-visible day promptly on scroll, without waiting for scrolling to stop", () => {
      vi.useFakeTimers();
      const onFocus = vi.fn();
      render(
        <MapRail
          days={[day(), day({ index: 1, dayId: "d2", label: "Day 2" }), day({ index: 2, dayId: "d3", label: "Day 3" })]}
          focusedDay={0}
          onFocus={onFocus}
        />,
      );
      const [, secondButton] = screen.getAllByRole("button");
      const rail = screen.getByLabelText("Days");

      // Day 2 becomes the most-visible entry; the very next scroll event
      // reacts immediately (a leading-edge throttle, not a trailing debounce)
      // — no waiting for scrolling to pause.
      triggerIntersection([{ target: secondButton!, isIntersecting: true, intersectionRatio: 0.9 }]);
      fireEvent.scroll(rail);

      expect(onFocus).toHaveBeenCalledWith(1);
      expect(onFocus).toHaveBeenCalledTimes(1);
    });

    it("updates focus again as a new day becomes dominant, without needing the scroll to stop", () => {
      vi.useFakeTimers();
      const onFocus = vi.fn();
      render(
        <MapRail
          days={[day(), day({ index: 1, dayId: "d2", label: "Day 2" }), day({ index: 2, dayId: "d3", label: "Day 3" })]}
          focusedDay={0}
          onFocus={onFocus}
        />,
      );
      const [, secondButton, thirdButton] = screen.getAllByRole("button");
      const rail = screen.getByLabelText("Days");
      const rootBounds = { top: 0, bottom: 600 }; // rail viewport center = 300

      triggerIntersection([
        {
          target: secondButton!,
          isIntersecting: true,
          intersectionRatio: 0.9,
          boundingClientRect: { top: 200, bottom: 300 }, // center 250, distance 50
          rootBounds,
        },
      ]);
      fireEvent.scroll(rail);
      expect(onFocus).toHaveBeenLastCalledWith(1);

      // Scrolling continues (never stops) and day 3's center lands nearer the
      // rail's own center than day 2's remembered position — once the light
      // throttle window has passed, the rail reacts to the new closest day.
      triggerIntersection([
        {
          target: thirdButton!,
          isIntersecting: true,
          intersectionRatio: 0.95,
          boundingClientRect: { top: 260, bottom: 340 }, // center 300, distance 0
          rootBounds,
        },
      ]);
      vi.advanceTimersByTime(50);
      fireEvent.scroll(rail);

      expect(onFocus).toHaveBeenLastCalledWith(2);
    });

    it("coalesces a burst of scroll events within the throttle window instead of firing for every one", () => {
      vi.useFakeTimers();
      const onFocus = vi.fn();
      render(
        <MapRail
          days={[day(), day({ index: 1, dayId: "d2", label: "Day 2" }), day({ index: 2, dayId: "d3", label: "Day 3" })]}
          focusedDay={0}
          onFocus={onFocus}
        />,
      );
      const [, secondButton, thirdButton] = screen.getAllByRole("button");
      const rail = screen.getByLabelText("Days");
      const rootBounds = { top: 0, bottom: 600 }; // rail viewport center = 300

      // Leading scroll event reacts immediately.
      triggerIntersection([
        {
          target: secondButton!,
          isIntersecting: true,
          intersectionRatio: 0.6,
          boundingClientRect: { top: 150, bottom: 250 }, // center 200, distance 100
          rootBounds,
        },
      ]);
      fireEvent.scroll(rail);
      expect(onFocus).toHaveBeenCalledTimes(1);
      expect(onFocus).toHaveBeenLastCalledWith(1);

      // A burst of further scroll events lands inside the same throttle
      // window — only a single trailing evaluation should fire, not one per
      // event. Day 3's center is now the one nearest the rail's center.
      triggerIntersection([
        {
          target: thirdButton!,
          isIntersecting: true,
          intersectionRatio: 0.9,
          boundingClientRect: { top: 260, bottom: 340 }, // center 300, distance 0
          rootBounds,
        },
      ]);
      fireEvent.scroll(rail);
      fireEvent.scroll(rail);
      fireEvent.scroll(rail);
      expect(onFocus).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(50);
      expect(onFocus).toHaveBeenCalledTimes(2);
      expect(onFocus).toHaveBeenLastCalledWith(2);
    });

    it("does not re-emit the same day repeatedly while it stays the most visible", () => {
      vi.useFakeTimers();
      const onFocus = vi.fn();
      render(
        <MapRail
          days={[day(), day({ index: 1, dayId: "d2", label: "Day 2" })]}
          focusedDay={0}
          onFocus={onFocus}
        />,
      );
      const [, secondButton] = screen.getAllByRole("button");
      const rail = screen.getByLabelText("Days");

      triggerIntersection([{ target: secondButton!, isIntersecting: true, intersectionRatio: 0.9 }]);
      fireEvent.scroll(rail);
      vi.advanceTimersByTime(300);
      expect(onFocus).toHaveBeenCalledTimes(1);

      // Scrolling continues but the same day remains most visible.
      fireEvent.scroll(rail);
      vi.advanceTimersByTime(300);
      expect(onFocus).toHaveBeenCalledTimes(1);
    });

    it("does not call onFocus just from mounting — only an actual scroll can trigger a new focus", () => {
      vi.useFakeTimers();
      const onFocus = vi.fn();
      render(
        <MapRail
          days={[day(), day({ index: 1, dayId: "d2", label: "Day 2" })]}
          focusedDay={0}
          onFocus={onFocus}
        />,
      );
      const [, secondButton] = screen.getAllByRole("button");

      // The observer reports intersection data (as it would on initial layout)
      // but the rail itself never received a scroll event.
      triggerIntersection([{ target: secondButton!, isIntersecting: true, intersectionRatio: 0.9 }]);
      vi.advanceTimersByTime(500);

      expect(onFocus).not.toHaveBeenCalled();
    });

    it("still focuses a day on click, unaffected by the scroll-driven path", async () => {
      vi.useRealTimers();
      const onFocus = vi.fn();
      render(
        <MapRail
          days={[day(), day({ index: 1, dayId: "d2", label: "Day 2" })]}
          focusedDay={0}
          onFocus={onFocus}
        />,
      );

      await userEvent.click(screen.getAllByRole("button")[1]!);

      expect(onFocus).toHaveBeenCalledWith(1);
    });

    it("prefers the day closest to the rail's center over one that merely ties on ratio", () => {
      vi.useFakeTimers();
      const onFocus = vi.fn();
      render(
        <MapRail
          days={[day(), day({ index: 1, dayId: "d2", label: "Day 2" })]}
          focusedDay={null}
          onFocus={onFocus}
        />,
      );
      const [first, second] = screen.getAllByRole("button");
      const rail = screen.getByLabelText("Days");

      // Both days report the same, fully-visible ratio — ratio alone can't
      // break the tie. Day 1 sits centered in the rail's own viewport; day 2
      // sits near its bottom edge. Position decides, and it favors the
      // EARLIER day here — the opposite of the old (wrong) "ties go to the
      // later day" rule, proving ratio is no longer what's compared.
      const rootBounds = { top: 0, bottom: 600 }; // center 300
      triggerIntersection([
        { target: first!, isIntersecting: true, intersectionRatio: 1, boundingClientRect: { top: 250, bottom: 350 }, rootBounds },
        { target: second!, isIntersecting: true, intersectionRatio: 1, boundingClientRect: { top: 500, bottom: 590 }, rootBounds },
      ]);
      fireEvent.scroll(rail);

      expect(onFocus).toHaveBeenCalledWith(0);
    });

    it("when many days are simultaneously at full ratio, focus tracks whichever is closest to the rail's center — not the last one tied on ratio", () => {
      // Mirrors the measured live bug: ~95px-tall day buttons in a ~600px
      // rail viewport put up to 6 days at intersectionRatio ~1 simultaneously.
      // The old ratio-tie-break (">=", later day wins) jumped straight to
      // the 6th day the instant any tie occurred. Only the day whose own
      // center is nearest the rail's center should be picked.
      vi.useFakeTimers();
      const onFocus = vi.fn();
      const days = Array.from({ length: 6 }, (_, i) => day({ index: i, dayId: `d${i + 1}`, label: `Day ${i + 1}` }));
      render(<MapRail days={days} focusedDay={null} onFocus={onFocus} />);
      const buttons = screen.getAllByRole("button");
      const rail = screen.getByLabelText("Days");

      const rootBounds = { top: 0, bottom: 600 }; // center 300
      triggerIntersection(
        buttons.map((target, i) => ({
          target,
          isIntersecting: true,
          intersectionRatio: 1,
          boundingClientRect: { top: i * 95, bottom: i * 95 + 95 },
          rootBounds,
        })),
      );
      fireEvent.scroll(rail);

      // Day 4 (index 3) spans 285-380, center 332.5 — closest to 300 of the
      // six (distance 32.5, vs. 252.5/157.5/62.5/127.5/222.5 for the rest).
      expect(onFocus).toHaveBeenCalledWith(3);
    });

    it("focuses the actual last day when the rail is scrolled to its bottom, even if an earlier day ties on ratio", () => {
      vi.useFakeTimers();
      const onFocus = vi.fn();
      const days = [day(), day({ index: 1, dayId: "d2" }), day({ index: 2, dayId: "d3" })];
      render(<MapRail days={days} focusedDay={0} onFocus={onFocus} />);
      const [first, , third] = screen.getAllByRole("button");
      const rail = screen.getByLabelText("Days");

      // jsdom computes no real layout, so a test exercising scroll-boundary
      // logic has to set these directly, matching what a real browser would
      // report once scrolled all the way down.
      Object.defineProperty(rail, "scrollHeight", { value: 1000, configurable: true });
      Object.defineProperty(rail, "clientHeight", { value: 400, configurable: true });
      Object.defineProperty(rail, "scrollTop", { value: 600, configurable: true });

      // The first day and the last day both happen to be fully visible at
      // once (common near the bottom of a short list) — naive "first ratio
      // wins" tie-breaking would report the first day forever, making the
      // last day unreachable by scrolling.
      triggerIntersection([
        { target: first!, isIntersecting: true, intersectionRatio: 1 },
        { target: third!, isIntersecting: true, intersectionRatio: 1 },
      ]);
      fireEvent.scroll(rail);

      expect(onFocus).toHaveBeenCalledWith(2);
    });

    it("focuses the first day when the rail is scrolled to its top", () => {
      vi.useFakeTimers();
      const onFocus = vi.fn();
      const days = [day(), day({ index: 1, dayId: "d2" }), day({ index: 2, dayId: "d3" })];
      render(<MapRail days={days} focusedDay={2} onFocus={onFocus} />);
      const [first, , third] = screen.getAllByRole("button");
      const rail = screen.getByLabelText("Days");

      Object.defineProperty(rail, "scrollHeight", { value: 1000, configurable: true });
      Object.defineProperty(rail, "clientHeight", { value: 400, configurable: true });
      Object.defineProperty(rail, "scrollTop", { value: 0, configurable: true });

      triggerIntersection([
        { target: first!, isIntersecting: true, intersectionRatio: 1 },
        { target: third!, isIntersecting: true, intersectionRatio: 1 },
      ]);
      fireEvent.scroll(rail);

      expect(onFocus).toHaveBeenCalledWith(0);
    });
  });
});
