import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { TripDetail } from "@tc/contracts";
import { renderMacro, type TripStripPayload } from "@tc/pages";
import { tripDetailFactory } from "@tc/factories";
import { chipModel } from "@/lib/dayChips";
import { dayAccents } from "@/lib/dayAccent";
import { cityAccents } from "../cityAccents";
import { TripStripBlock } from "./TripStripBlock";

afterEach(cleanup);

// One located stop per day in the given city; `null` is a day naming no place.
function tripWithCities(cities: readonly (string | null)[]): TripDetail {
  const trip = tripDetailFactory.build({}, { transient: { dayCount: cities.length, activitiesPerDay: 1 } });
  trip.days = trip.days.map((day, index) => ({ ...day, date: `2027-06-0${index + 1}` }));
  trip.days.forEach((day, index) => {
    const id = day.activityIds[0]!;
    const city = cities[index]!;
    trip.activities[id] = { ...trip.activities[id]!, location: city === null ? null : { name: `${city} stop`, city } };
  });
  return trip;
}

function stripOf(trip: TripDetail): TripStripPayload {
  const outcome = renderMacro({ trip, page: { tripId: trip.tripId }, user: null, globals: null, today: null }, "trip.strip", {});
  if (outcome.status !== "ok" || outcome.rendered.kind !== "block" || outcome.rendered.block.kind !== "trip-strip") {
    throw new Error(`expected a trip-strip block, got ${outcome.status}`);
  }
  return outcome.rendered.block;
}

describe("TripStripBlock", () => {
  // The strip is a picture, so its accessible name is the whole of what a
  // screen reader gets: every run, in words.
  it("is one image named by the runs it draws", () => {
    const trip = tripWithCities(["Tokyo", "Tokyo", "Kyoto"]);
    render(<TripStripBlock payload={stripOf(trip)} accents={cityAccents(trip)} />);
    expect(screen.getAllByRole("img").map((image) => image.getAttribute("aria-label"))).toEqual([
      "Days 1–2 Tokyo (Jun 1 – Jun 2), day 3 Kyoto (Jun 3)",
    ]);
  });

  // The strip's colours are the board's colours. Asserted against the BOARD's
  // own derivation (Board.tsx: chipModel → dayAccents), not against
  // `cityAccents`, so a strip that coloured by anything else — its own hash, a
  // city's index in the run list — fails here even if it agreed with itself.
  // Five cities and a day with none, so every family is spent and the probe's
  // collision handling decides at least one of them.
  it("paints every day in the family the board paints that day", () => {
    const trip = tripWithCities(["Tokyo", "Kyoto", "Kyoto", null, "Osaka", "Nara", "Kobe"]);
    render(<TripStripBlock payload={stripOf(trip)} accents={cityAccents(trip)} />);

    const board = dayAccents(chipModel(trip).map((day) => day.city)).map((accent) => accent.tint);
    const cells = screen.getAllByTestId("trip-strip-day");
    expect(cells.map((cell) => cell.dataset.dayId)).toEqual(trip.days.map((day) => day.dayId));
    expect(cells.map((cell) => cell.dataset.accent)).toEqual(board);
    expect(board[3]).toBe("neutral");
  });
});
