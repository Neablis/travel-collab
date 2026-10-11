import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_TRIPS } from "@/lib/demoTrip";
import { rememberDemoClone } from "@/lib/pendingDemoClone";

const pushMock = vi.fn();
const duplicateTripMock = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));
vi.mock("@/lib/apiClient", () => ({ duplicateTrip: (tripId: string) => duplicateTripMock(tripId) }));
// The board and the phone bar are the ordinary trip surface, covered where
// they live; what is under test here is the banner's copy.
vi.mock("@/components/board/TripBoardScreen", () => ({ TripBoardScreen: () => null }));
vi.mock("@/components/trip/context/TripProvider", () => ({ TripProvider: () => null }));
vi.mock("@/components/nav/PhoneTabBar", () => ({ PhoneTabBar: () => null, PhoneTabBarFallback: () => null }));

const { DemoTripScreen } = await import("./DemoTripScreen");

const demo = (slug: string) => DEMO_TRIPS.find((d) => d.slug === slug)!;

beforeEach(() => {
  window.localStorage.clear();
  pushMock.mockReset();
  duplicateTripMock.mockReset().mockResolvedValue({ ok: true, value: { tripId: "copy" } });
});

afterEach(() => {
  window.localStorage.clear();
});

describe("DemoTripScreen finishing a copy after sign-in", () => {
  // M42 D1: the marker names the demo that was pressed, and the round trip
  // through sign-in can land on another one's page. Copying the page's demo
  // there would hand somebody who asked for Iceland a trip they never chose.
  it("copies the demo the marker names, not the one on the page", async () => {
    rememberDemoClone(demo("iceland-ring-road").tripId);

    render(<DemoTripScreen demo={demo("japan")} />);

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/trips/copy"));
    expect(duplicateTripMock.mock.calls).toEqual([[demo("iceland-ring-road").tripId]]);
  });
});
