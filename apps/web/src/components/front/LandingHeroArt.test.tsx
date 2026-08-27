import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setViewportMatches } from "../../../vitest.setup";
import { LandingHeroArt } from "./LandingHeroArt";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  setViewportMatches({});
});

// One string per view that appears in no other view, so "shows X" and
// "no longer shows Y" are the same assertion read two ways.
const MAP = "Fushimi Inari";
const TIMELINE = "Shinkansen to Osaka";
const NOTEBOOK = "Getting to Kurama — Day 5";

const pill = (label: string) => screen.getByRole("button", { name: label });

describe("LandingHeroArt", () => {
  it("opens on the Day 6 map", () => {
    render(<LandingHeroArt />);
    expect(screen.getByText(MAP)).toBeDefined();
  });

  it("offers all three days as pills", () => {
    render(<LandingHeroArt />);
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Day 5", "Day 6", "Day 7"]);
  });

  // The pill order is not the view order (`dc.html:4297-4299`): Day 5 is the
  // third view and Day 7 the second. These two guard that mapping — a
  // positional one would show the Notebook for "Day 7".
  it("shows the Day 7 timeline, and only that, when its pill is clicked", () => {
    render(<LandingHeroArt />);
    fireEvent.click(pill("Day 7"));
    expect(screen.getByText(TIMELINE)).toBeDefined();
    expect(screen.queryByText(MAP)).toBeNull();
  });

  it("shows the Day 5 notebook when its pill is clicked", () => {
    render(<LandingHeroArt />);
    fireEvent.click(pill("Day 5"));
    expect(screen.getByText(NOTEBOOK)).toBeDefined();
    expect(screen.queryByText(MAP)).toBeNull();
  });

  it("advances on its own every 10 seconds", () => {
    vi.useFakeTimers();
    render(<LandingHeroArt />);

    act(() => void vi.advanceTimersByTime(10_000));
    expect(screen.getByText(TIMELINE)).toBeDefined();

    act(() => void vi.advanceTimersByTime(10_000));
    expect(screen.getByText(NOTEBOOK)).toBeDefined();
  });

  // Picking a day ends the rotation permanently (Mitchell, 2026-08-27) — the
  // pills are the WCAG 2.2.2 stop mechanism. This deliberately contradicts
  // SPEC §14's "restarts the timer" and matches the design file's own
  // `heroStart()` comment instead; SPEC §14 is stale here.
  //
  // `getTimerCount()` is asserted alongside the rendered view, not instead of
  // it: a bare "still on the notebook" check passes vacuously at any multiple
  // of 3 × 10s, because an un-stopped rotation wraps back to where it started.
  // The same trap already ate the reduced-motion test below once.
  it("stops rotating for good once a day is picked", () => {
    vi.useFakeTimers();
    render(<LandingHeroArt />);

    act(() => void vi.advanceTimersByTime(9_000));
    fireEvent.click(pill("Day 5"));
    expect(screen.getByText(NOTEBOOK)).toBeDefined();
    expect(vi.getTimerCount()).toBe(0);

    // Past the original deadline, and past a full cycle: neither moves it.
    act(() => void vi.advanceTimersByTime(1_000));
    expect(screen.getByText(NOTEBOOK)).toBeDefined();
    act(() => void vi.advanceTimersByTime(10_000));
    expect(screen.getByText(NOTEBOOK)).toBeDefined();
    act(() => void vi.advanceTimersByTime(60_000));
    expect(screen.getByText(NOTEBOOK)).toBeDefined();
  });

  it("still lets a reader switch views after rotation has stopped", () => {
    vi.useFakeTimers();
    render(<LandingHeroArt />);

    fireEvent.click(pill("Day 5"));
    expect(screen.getByText(NOTEBOOK)).toBeDefined();

    fireEvent.click(pill("Day 7"));
    expect(screen.getByText(TIMELINE)).toBeDefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("names the pill group so the stop behaviour is discoverable", () => {
    render(<LandingHeroArt />);
    expect(
      screen.getByRole("group", { name: /stops the preview rotating/i }),
    ).toBeDefined();
  });

  // Not in the design, which rotates unconditionally — so this is the only
  // thing holding the guard in place.
  it("does not auto-advance under prefers-reduced-motion, but still takes pill clicks", () => {
    setViewportMatches({ "(prefers-reduced-motion: reduce)": true });
    vi.useFakeTimers();
    render(<LandingHeroArt />);

    // No interval at all, and none of the first two deadlines lands. Both
    // assertions are here on purpose: a bare "still on the map" after some
    // round number of seconds passes vacuously whenever the elapsed time is a
    // multiple of 3 × 10s, because the rotation would have wrapped back to it.
    expect(vi.getTimerCount()).toBe(0);
    act(() => void vi.advanceTimersByTime(10_000));
    expect(screen.getByText(MAP)).toBeDefined();
    act(() => void vi.advanceTimersByTime(10_000));
    expect(screen.getByText(MAP)).toBeDefined();

    fireEvent.click(pill("Day 7"));
    expect(screen.getByText(TIMELINE)).toBeDefined();
  });

  it("stops rotating on unmount", () => {
    vi.useFakeTimers();
    const { unmount } = render(<LandingHeroArt />);
    unmount();

    // A surviving interval would setState on an unmounted tree; nothing to
    // assert on screen, so assert the interval itself is gone.
    expect(vi.getTimerCount()).toBe(0);
  });
});
