import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { StopDirectionsPayload } from "@tc/pages";
import { StopDirectionsBlock } from "./StopDirectionsBlock";

// *Directions* (M52 decisions 15, 16): which stop is the resolver's
// (`directions.test.ts`); here, that the link the block draws is the maps
// app's, to the stop's place, by the leg leading in.

afterEach(cleanup);

const payload: StopDirectionsPayload = {
  kind: "stop-directions", activityId: "a1", title: "Dinner at Tasca", time: "19:00 – 21:00",
  place: { name: "Tasca do Chico", lat: 38.7116, lng: -9.1446 }, mode: "walk",
};

describe("StopDirectionsBlock", () => {
  it("links to the stop's place in Google Maps, walking", () => {
    render(<StopDirectionsBlock payload={payload} interactive />);
    expect(screen.getByRole("link", { name: "Directions to Dinner at Tasca" }).getAttribute("href")).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=38.7116%2C-9.1446&travelmode=walking",
    );
    expect(screen.getByText("19:00 – 21:00")).toBeTruthy();
  });
});
