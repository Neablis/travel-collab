import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NowStop, TripNowPayload } from "@tc/pages";
import { registerBoardFocus } from "@/components/chat/boardFocus";
import { TripNowBlock } from "./TripNowBlock";

// *Now and next* (M52 decision 15) on the screen: it re-picks the two stops on
// its own minute clock, links each placed stop to directions, and a stop's
// name focuses it on the board. Which stops the resolver hands over is
// `nowNext.test.ts`'s.

const MINUTE = 60_000;
const T = Date.parse("2026-06-10T10:00:00Z"); // 11:00 in Lisbon
const stop = (title: string, from: number, to: number, extra: Partial<NowStop> = {}): NowStop => ({
  activityId: `id-${title}`, title, start: T + from * MINUTE, end: T + to * MINUTE, time: "", place: null, mode: null, ...extra,
});
const museum = stop("Museum", -30, 90, { time: "10:30 – 12:30", place: { name: "Gulbenkian Museum", lat: 38.7372, lng: -9.1543 }, mode: "train" });
const lunch = stop("Lunch", 120, 180, { time: "13:00 – 14:00" });
const payload: TripNowPayload = { kind: "trip-now", stops: [museum, lunch] };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(T);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("TripNowBlock", () => {
  it("shows now and next, and moves on each minute while it is open", () => {
    render(<TripNowBlock payload={payload} interactive />);
    expect(screen.getByText("Museum")).toBeTruthy();
    expect(screen.getByText("in 2 h · 13:00 – 14:00")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(91 * MINUTE);
    });
    expect(screen.queryByText("Museum")).toBeNull();
    expect(screen.getByText("in 29 min · 13:00 – 14:00")).toBeTruthy();
  });

  it("says Nothing more planned today once both have passed", () => {
    render(<TripNowBlock payload={payload} interactive />);
    act(() => {
      vi.advanceTimersByTime(181 * MINUTE);
    });
    expect(screen.getByText("Nothing more planned today")).toBeTruthy();
  });

  it("links a placed stop to directions, by the leg leading in", () => {
    render(<TripNowBlock payload={payload} interactive />);
    const link = screen.getByRole("link", { name: "Directions to Museum" });
    expect(link.getAttribute("href")).toBe("https://www.google.com/maps/dir/?api=1&destination=38.7372%2C-9.1543&travelmode=transit");
    // Lunch has no place, so nothing for Maps to find.
    expect(screen.queryByRole("link", { name: "Directions to Lunch" })).toBeNull();
  });

  it("focuses a stop on the board when its name is tapped", () => {
    const focusActivity = vi.fn();
    const takeBack = registerBoardFocus({
      days: [], stops: [{ activityId: museum.activityId, label: "Museum", dayId: "d1", nearness: "trip" }],
      focusDay: vi.fn(), focusActivity,
    });
    render(<TripNowBlock payload={payload} interactive />);
    fireEvent.click(screen.getByRole("button", { name: "Museum" }));
    expect(focusActivity).toHaveBeenCalledWith(museum.activityId);
    takeBack();
  });

  it("leaves a stop's name as plain text while the page is being edited", () => {
    const takeBack = registerBoardFocus({
      days: [], stops: [{ activityId: museum.activityId, label: "Museum", dayId: "d1", nearness: "trip" }],
      focusDay: vi.fn(), focusActivity: vi.fn(),
    });
    render(<TripNowBlock payload={payload} interactive={false} />);
    expect(screen.getByText("Museum")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Museum" })).toBeNull();
    takeBack();
  });
});
