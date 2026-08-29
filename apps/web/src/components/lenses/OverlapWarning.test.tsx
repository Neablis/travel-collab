import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Overlap } from "./overlapData";
import { OverlapWarning } from "./OverlapWarning";

afterEach(cleanup);

// The plan's worked example: Lunch at Kagari (12:30–14:00) overlapping Nezu
// Museum (10:30–13:00) by 30 minutes. Built directly rather than through
// overlapsForDay so this file tests the copy, not the derivation —
// overlapData.test.ts owns the latter.
const overlap: Overlap = {
  conflictId: "time-overlap:d1:a:b",
  laterActivityId: "b",
  otherActivityId: "a",
  otherTitle: "Nezu Museum",
  otherStart: "10:30",
  otherEnd: "13:00",
  overlapMinutes: 30,
  suggestedStart: "13:00",
  suggestedEnd: "14:30",
};

describe("OverlapWarning", () => {
  it("states which stop it overlaps, and by how much", () => {
    render(<OverlapWarning overlap={overlap} onFix={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByText("Overlaps Nezu Museum, 10:30 am – 1 pm — 30 m on top of each other.")).toBeTruthy();
  });

  it("offers a fix labelled with the suggested start", () => {
    render(<OverlapWarning overlap={overlap} onFix={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Start 1 pm" })).toBeTruthy();
  });

  // A move that would not fit inside the day has no end to land on
  // (suggestedEnd null, overlapData.ts). The warning is still worth showing;
  // a fix button that could only shorten the stop is not.
  it("offers no fix when the duration-preserving move would not fit in the day", async () => {
    const onFix = vi.fn();
    const onDismiss = vi.fn();
    render(<OverlapWarning overlap={{ ...overlap, suggestedEnd: null }} onFix={onFix} onDismiss={onDismiss} />);

    expect(screen.getByText("Overlaps Nezu Museum, 10:30 am – 1 pm — 30 m on top of each other.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start 1 pm" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onFix).not.toHaveBeenCalled();
  });

  // A viewer keeps the sentence and loses both controls: "Start HH:MM" is an
  // UpdateActivity and "Dismiss" is a DismissConflict, but the overlap itself
  // is information about the trip (CodeRabbit, PR #78).
  it("keeps the sentence and withholds both controls for a viewer", () => {
    render(<OverlapWarning overlap={overlap} onFix={vi.fn()} onDismiss={vi.fn()} readOnly />);
    expect(screen.getByText("Overlaps Nezu Museum, 10:30 am – 1 pm — 30 m on top of each other.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start 1 pm" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
  });

  it("fixes and dismisses independently", async () => {
    const onFix = vi.fn();
    const onDismiss = vi.fn();
    render(<OverlapWarning overlap={overlap} onFix={onFix} onDismiss={onDismiss} />);

    await userEvent.click(screen.getByRole("button", { name: "Start 1 pm" }));
    expect(onFix).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
