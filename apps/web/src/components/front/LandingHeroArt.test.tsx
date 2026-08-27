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

  // SPEC §14: a click "restarts the timer". The design file's own comment says
  // the click stops rotation for good; that comment is stale and contradicts
  // its `d.pick` handler, which calls `heroStart()`.
  it("restarts the 10s timer on a pill click rather than inheriting what was left", () => {
    vi.useFakeTimers();
    render(<LandingHeroArt />);

    act(() => void vi.advanceTimersByTime(9_000));
    fireEvent.click(pill("Day 5"));

    // 9s more: past the original deadline, short of the restarted one.
    act(() => void vi.advanceTimersByTime(9_000));
    expect(screen.getByText(NOTEBOOK)).toBeDefined();

    act(() => void vi.advanceTimersByTime(1_000));
    expect(screen.getByText(MAP)).toBeDefined();
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
