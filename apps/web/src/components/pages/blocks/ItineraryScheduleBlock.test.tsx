import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ItineraryPayload } from "@tc/pages";
import { cityAccents } from "../cityAccents";
import { ItineraryScheduleCompact } from "./ItineraryScheduleBlock";

// Mitchell, phone Overview: the day-by-day "is too run on sentence. Can we
// include more newlines between activities so it's actually readable?" The
// phone form used to run a day's stops together as one wrapped line,
// `time title · time title`. Each stop is its own line now: still no place
// line and no per-stop list (the phone density m39-phone-overview measures),
// but one stop to a line.
describe("ItineraryScheduleCompact", () => {
  const payload: ItineraryPayload = {
    kind: "itinerary-schedule",
    days: [
      {
        dayId: "d1",
        ordinal: 1,
        date: "Monday 12 October",
        cities: ["Tokyo"],
        stops: [
          { time: "2:30 pm", until: null, title: "Land at Haneda", place: null, status: "Travel" },
          { time: "7 pm", until: null, title: "Dinner at Gonpachi", place: null, status: "To book" },
          { time: null, until: null, title: "Walk", place: null, status: null },
        ],
      },
    ],
  };

  it("puts each stop on a line of its own, with its time and standing", () => {
    render(<ItineraryScheduleCompact payload={payload} accents={cityAccents(null)} />);
    const lines = screen.getAllByTestId("itinerary-stop");
    expect(lines.map((line) => line.textContent)).toEqual([
      "2:30 pm Land at Haneda (Travel)",
      "7 pm Dinner at Gonpachi (To book)",
      "Walk",
    ]);
  });

  it("no longer joins the stops with a dot", () => {
    render(<ItineraryScheduleCompact payload={payload} accents={cityAccents(null)} />);
    expect(screen.getByTestId("itinerary-day").textContent).not.toContain(" · ");
  });
});
