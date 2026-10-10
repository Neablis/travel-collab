import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { tripCoverFactory } from "@tc/factories";
import { primeCached } from "@/lib/queryCache";
import { coverKeys } from "@/lib/queryKeys";
import { setViewportMatches } from "../../../vitest.setup";
import { TripHeaderSkeleton } from "./TripHeaderSkeleton";

const TRIP = "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f";

afterEach(cleanup);

// PR #384 review: the real header draws the cover band above itself from 768px
// up, so a skeleton without it moved the header 112px down when the trip
// landed. Where the cover is already known, the skeleton keeps its place.
describe("TripHeaderSkeleton — the cover band's place", () => {
  it("keeps the band's place from 768px up when the trip's cover is known", () => {
    setViewportMatches({ "(min-width: 768px)": true });
    primeCached(coverKeys.trip(TRIP), tripCoverFactory.build());
    render(<TripHeaderSkeleton tripId={TRIP} />);
    expect(screen.getByTestId("trip-cover-skeleton")).toBeTruthy();
  });

  it("keeps none on a phone, which never shows the band", () => {
    setViewportMatches({ "(max-width: 767px)": true });
    primeCached(coverKeys.trip(TRIP), tripCoverFactory.build());
    render(<TripHeaderSkeleton tripId={TRIP} />);
    expect(screen.queryByTestId("trip-cover-skeleton")).toBeNull();
  });
});
