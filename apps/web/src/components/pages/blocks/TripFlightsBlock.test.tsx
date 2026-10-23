import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FlightLine, TripFlightsPayload } from "@tc/pages";
import { EditorHost, useEditor } from "@/components/trip/context/EditorHost";
import { TripFlightsBlock } from "./TripFlightsBlock";

// *Your flights* (M52 decision 15) on the screen: the line and its countdown,
// which keeps time on the block's own clock, and *Add your flight*, offered to
// someone who can edit the trip, opening the stop editor as a flight. Which
// flight is shown is `flights.test.ts`'s.

const canEditBoard = vi.hoisted(() => ({ value: true }));
vi.mock("@/components/trip/context/TripProvider", () => ({
  useOptionalTrip: () => ({ canEditBoard: canEditBoard.value }),
}));

const MINUTE = 60_000;
const T = Date.parse("2026-06-08T07:00:00Z");
const line: FlightLine = {
  activityId: "f1", title: "Flight to Tokyo", flightNumber: "TP 1234", from: "Lisbon", to: "Tokyo",
  departs: "12:00", arrives: "07:00 Jun 11", startsAt: T + (2 * 24 * 60 + 7 * 60) * MINUTE,
};
const none: TripFlightsPayload = { kind: "trip-flights", heading: "none", flights: [], dayId: "day-2" };

/** What the editor was last opened with. */
function EditorProbe() {
  const { state } = useEditor();
  return <output aria-label="editor">{JSON.stringify(state)}</output>;
}

beforeEach(() => {
  canEditBoard.value = true;
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(T);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("TripFlightsBlock", () => {
  it("shows the next flight's number, route and times, and counts down to it", () => {
    render(<TripFlightsBlock payload={{ kind: "trip-flights", heading: "next", flights: [line], dayId: "day-1" }} interactive />);
    expect(screen.getByText("Next flight")).toBeTruthy();
    expect(screen.getByText("TP 1234 · Lisbon → Tokyo")).toBeTruthy();
    expect(screen.getByText("12:00 → 07:00 Jun 11")).toBeTruthy();
    expect(screen.getByText("Leaves in 2 days, 7 h")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(61 * MINUTE);
    });
    expect(screen.getByText("Leaves in 2 days, 5 h")).toBeTruthy();
  });

  it("offers Add your flight on a trip with none, opening the stop editor as a flight", () => {
    render(
      <EditorHost>
        <TripFlightsBlock payload={none} interactive />
        <EditorProbe />
      </EditorHost>,
    );
    expect(screen.getByText("No flights on this trip yet")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add your flight" }));
    expect(JSON.parse(screen.getByRole("status", { name: "editor" }).textContent!)).toEqual({
      mode: "create", prefill: { dayId: "day-2", title: "Flight", kind: "transit", mode: "flight" },
    });
  });

  it("offers nothing to add to someone who cannot edit the trip", () => {
    canEditBoard.value = false;
    render(
      <EditorHost>
        <TripFlightsBlock payload={none} interactive />
      </EditorHost>,
    );
    expect(screen.getByText("No flights on this trip yet")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add your flight" })).toBeNull();
  });

  it("offers nothing to add while the page is being edited", () => {
    render(
      <EditorHost>
        <TripFlightsBlock payload={none} interactive={false} />
      </EditorHost>,
    );
    expect(screen.getByText("No flights on this trip yet")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add your flight" })).toBeNull();
  });
});
