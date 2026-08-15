import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MapRail } from "./MapRail";
import type { MapDay } from "./mapRailData";

afterEach(cleanup);

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
});
