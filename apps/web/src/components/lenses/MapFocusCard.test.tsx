import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MapFocusCard } from "./MapFocusCard";
import type { MapDay } from "./mapRailData";

afterEach(cleanup);

const day = (over: Partial<MapDay> = {}): MapDay => ({
  index: 0, dayId: "d1", label: "Day 1", date: "2026-09-05", city: "Rochester",
  accent: "warning", stops: [{ activityId: "a", title: "Stop A", lat: 43.15, lng: -77.6 }],
  unlocatedCount: 0, totalKm: 4.2, bars: [{ grow: 1, color: "warning" }], flagText: null, ...over,
});

describe("MapFocusCard", () => {
  it("renders nothing when no day is focused", () => {
    const { container } = render(<MapFocusCard day={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the day's title and stop/distance stat", () => {
    render(<MapFocusCard day={day()} />);
    expect(screen.getByText(/Rochester/)).toBeTruthy();
    expect(screen.getByText(/1 stop/)).toBeTruthy();
    expect(screen.getByText(/4.2 km/)).toBeTruthy();
  });

  it("shows the day's flag as a note when it has one", () => {
    render(<MapFocusCard day={day({ stops: [], totalKm: null, flagText: "No stops yet" })} />);
    expect(screen.getByText("No stops yet")).toBeTruthy();
  });
});
