import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddToTripForm, type AddToTripChoice } from "./AddToTripForm";

// The form states what it acts on before it acts (M23 link 4): once a day is
// chosen, the copy names that day rather than still promising an append.

const TRIP_ID = "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f";
const DAY_4 = "bb000000-0000-4000-8000-000000000004";
const days = [1, 2, 3, 4].map((n) => ({ dayId: `bb000000-0000-4000-8000-00000000000${n}`, label: `Day ${n}` }));

afterEach(cleanup);

function renderForm(value: AddToTripChoice, dayCount = 1) {
  render(
    <AddToTripForm
      dayName="Railay"
      dayCount={dayCount}
      trips={[{ tripId: TRIP_ID, name: "Thailand" }]}
      days={days}
      value={value}
      onChange={vi.fn()}
    />,
  );
}

describe("AddToTripForm's copy", () => {
  it("names the chosen day, and that its stops are placed by time", () => {
    renderForm({ tripId: TRIP_ID, startingAt: DAY_4, startDate: "" });
    expect(screen.getByText(/lands on Day 4, its stops placed among that day's by time/)).toBeTruthy();
    expect(screen.queryByText(/appended at the end/)).toBeNull();
  });

  it("says where a longer Playbook's later days go", () => {
    renderForm({ tripId: TRIP_ID, startingAt: DAY_4, startDate: "" }, 3);
    expect(screen.getByText(/first day lands on Day 4.*any past the trip's last day are appended/)).toBeTruthy();
  });

  it("still promises the append when no day is chosen", () => {
    renderForm({ tripId: TRIP_ID, startingAt: "", startDate: "" });
    expect(screen.getByText(/The day is appended at the end, keeping its order and gaps/)).toBeTruthy();
  });
});
