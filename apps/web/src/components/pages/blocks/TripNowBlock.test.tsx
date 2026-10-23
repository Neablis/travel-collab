import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NowStop, TripNowPayload } from "@tc/pages";
import { tripDetailFixture } from "@tc/factories";
import { registerBoardFocus } from "@/components/chat/boardFocus";
import { MacroEditorContext } from "@/components/pages/editor/MacroEditorContext";
import { TripNowBlock } from "./TripNowBlock";

// *Now and next* (M52 decision 15) on the screen: it re-picks the two stops by
// the page's minute clock, links each placed stop to directions, and a stop's
// name focuses it on the board. Which stops the resolver hands over is
// `nowNext.test.ts`'s; that the page's clock moves is `PageEditor.test.tsx`'s.

const MINUTE = 60_000;
const T = Date.parse("2026-06-10T10:00:00Z"); // 11:00 in Lisbon
const stop = (title: string, from: number, to: number, extra: Partial<NowStop> = {}): NowStop => ({
  activityId: `id-${title}`, title, start: T + from * MINUTE, end: T + to * MINUTE, time: "", place: null, mode: null, ...extra,
});
const museum = stop("Museum", -30, 90, { time: "10:30 – 12:30", place: { name: "Gulbenkian Museum", lat: 38.7372, lng: -9.1543 }, mode: "train" });
const lunch = stop("Lunch", 120, 180, { time: "13:00 – 14:00" });
const payload: TripNowPayload = { kind: "trip-now", stops: [museum, lunch] };

/** `children` on a page whose clock reads `at`. */
function onPage(at: number, children: ReactNode) {
  const value = { detail: tripDetailFixture(), context: { tripId: "t" }, user: null, globals: null, editing: false, now: { at, deviceZone: "Europe/Lisbon" } };
  return <MacroEditorContext.Provider value={value}>{children}</MacroEditorContext.Provider>;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("TripNowBlock", () => {
  it("shows now and next, and moves on with the page's clock", () => {
    // The device's clock is an hour on from the page's: the block reads the
    // page's, so it says what the page around it was resolved at.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T + 60 * MINUTE);
    const { rerender } = render(onPage(T, <TripNowBlock payload={payload} interactive />));
    expect(screen.getByText("Museum")).toBeTruthy();
    expect(screen.getByText("in 2 h · 13:00 – 14:00")).toBeTruthy();
    rerender(onPage(T + 91 * MINUTE, <TripNowBlock payload={payload} interactive />));
    expect(screen.queryByText("Museum")).toBeNull();
    expect(screen.getByText("in 29 min · 13:00 – 14:00")).toBeTruthy();
  });

  it("says Nothing more planned today once both have passed", () => {
    render(onPage(T + 181 * MINUTE, <TripNowBlock payload={payload} interactive />));
    expect(screen.getByText("Nothing more planned today")).toBeTruthy();
  });

  it("links a placed stop to directions, by the leg leading in", () => {
    render(onPage(T, <TripNowBlock payload={payload} interactive />));
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
    render(onPage(T, <TripNowBlock payload={payload} interactive />));
    fireEvent.click(screen.getByRole("button", { name: "Museum" }));
    expect(focusActivity).toHaveBeenCalledWith(museum.activityId);
    takeBack();
  });

  it("leaves a stop's name as plain text while the page is being edited", () => {
    const takeBack = registerBoardFocus({
      days: [], stops: [{ activityId: museum.activityId, label: "Museum", dayId: "d1", nearness: "trip" }],
      focusDay: vi.fn(), focusActivity: vi.fn(),
    });
    render(onPage(T, <TripNowBlock payload={payload} interactive={false} />));
    expect(screen.getByText("Museum")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Museum" })).toBeNull();
    takeBack();
  });
});
