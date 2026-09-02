import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MapFocusCard } from "./MapFocusCard";
import type { MapDay } from "./mapRailData";

afterEach(cleanup);

const day = (over: Partial<MapDay> = {}): MapDay => ({
  index: 0, dayId: "d1", label: "Day 1", date: "2026-09-05", city: "Rochester",
  accent: "warning", stops: [{ activityId: "a", title: "Stop A", lat: 43.15, lng: -77.6, kind: "planned" }],
  unlocatedCount: 0, totalKm: 4.2, bars: [{ grow: 1, color: "warning" }], isEmpty: false, flagText: null, ...over,
});

describe("MapFocusCard", () => {
  it("renders nothing when no day is focused", () => {
    const { container } = render(<MapFocusCard day={null} />);
    // eslint-disable-next-line testing-library/no-node-access -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    expect(container.firstChild).toBeNull();
  });

  it("shows the day's title and stop/distance stat", () => {
    render(<MapFocusCard day={day()} />);
    expect(screen.getByText(/Rochester/)).toBeTruthy();
    expect(screen.getByText(/1 stop/)).toBeTruthy();
    expect(screen.getByText(/4.2 km/)).toBeTruthy();
  });

  it("shows the day's flag as a note when it has one", () => {
    render(<MapFocusCard day={day({ stops: [], totalKm: null, unlocatedCount: 1, flagText: "1 stop has no place yet" })} />);
    expect(screen.getByText("1 stop has no place yet")).toBeTruthy();
  });

  // Phase 6, copy table row "map focus card, empty day". The card's own string
  // for an empty day, deliberately different from the rail's "Nothing planned
  // yet" about the same day — see MapDay.isEmpty.
  it("says there are no stops yet on an empty day", () => {
    render(<MapFocusCard day={day({ isEmpty: true, stops: [], bars: [], totalKm: null })} />);
    expect(screen.getByText("No stops yet")).toBeTruthy();
    // The rail's wording must not leak into the card.
    expect(screen.queryByText("Nothing planned yet")).toBeNull();
  });

  // An empty day has no stat line to show, so the empty-day note is the only
  // thing under the title — the card still has content and doesn't collapse.
  it("drops the stat line but keeps the title on an empty day", () => {
    render(<MapFocusCard day={day({ isEmpty: true, stops: [], bars: [], totalKm: null })} />);
    expect(screen.getByText("Rochester")).toBeTruthy();
    expect(screen.queryByText(/stop ·/)).toBeNull();
  });

  // A day whose stops all lack coordinates is not empty — the card keeps the
  // unlocated-stops flag instead of claiming there are no stops.
  it("flags unlocated stops rather than calling the day empty", () => {
    render(
      <MapFocusCard day={day({ isEmpty: false, stops: [], bars: [], totalKm: null, unlocatedCount: 2, flagText: "2 stops have no place yet" })} />,
    );
    expect(screen.getByText("2 stops have no place yet")).toBeTruthy();
    expect(screen.queryByText("No stops yet")).toBeNull();
  });
});
