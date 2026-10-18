import { Suspense } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { costedTripDetailFixture } from "@tc/factories";
import { makeAccountPlanHandler, makeNearbyStopsHandler, makeTripHandlers } from "@/mocks/handlers";
import { tripFirstDataFixture } from "@/test-support/tripFirstData";

// PR 486 e2e (m46-trip-chat): **nothing the board mounts may suspend to the
// ROUTE's boundary.** The page sits in `(board)/loading.tsx`'s Suspense. The
// rack's dock — mounted only once hydrated — was a `next/dynamic` with no
// `loading`, which in the app router gives it no Suspense boundary of its own:
// while its chunk was on the wire it suspended to the route's, and React hid
// the whole server-rendered board (`display: none`) behind the loading
// skeleton. The Ask pill had no box, and a reader saw the board blink out.
//
// Two things this file does that the board's own suite cannot:
// - `next/dynamic` is the app router's (`React.lazy`, and a boundary only with
//   a `loading`), which a build aliases it to; under vitest it resolves to the
//   pages router's loadable, which never suspends at all.
// - the rack's chunk is genuinely pending (its import waits on a gate), which a
//   warmed module never is: React replays a lazy whose promise has settled.

vi.mock("next/dynamic", async () => {
  const appDynamic = await vi.importActual<{ default?: unknown }>("next/dist/shared/lib/app-dynamic.js");
  return { default: appDynamic.default ?? appDynamic };
});

const rackChunk = vi.hoisted(() => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  return { gate, release: () => release() };
});
vi.mock("@/components/trip/UnscheduledRack", async () => {
  await rackChunk.gate;
  return vi.importActual("@/components/trip/UnscheduledRack");
});

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("view=Plan"),
  usePathname: () => "/trips/x",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

import { TripBoardScreen } from "./TripBoardScreen";
import { TripProvider } from "@/components/trip/context/TripProvider";
import { FocusProvider } from "@/components/trip/context/FocusProvider";
import { EditorHost } from "@/components/trip/context/EditorHost";
import { LensRouter } from "@/components/trip/context/LensRouter";

const first = tripFirstDataFixture({ trip: costedTripDetailFixture() });
const server = setupServer(
  ...makeTripHandlers(first.trip.trip),
  makeAccountPlanHandler(),
  makeNearbyStopsHandler([]),
  http.get("/api/v1/trips/:tripId/guests", () => HttpResponse.json({ items: [] })),
);
beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(cleanup);
afterAll(() => server.close());

describe("TripBoardScreen — inside the route's Suspense boundary", () => {
  it("never falls back to the route's boundary while the rack's chunk loads", async () => {
    let routeFallbackShown = false;
    function RouteFallback() {
      routeFallbackShown = true;
      return null;
    }
    const tripId = first.trip.trip.tripId;
    render(
      <Suspense fallback={<RouteFallback />}>
        <TripProvider tripId={tripId} initial={first}>
          <FocusProvider>
            <EditorHost>
              <LensRouter>
                <TripBoardScreen tripId={tripId} />
              </LensRouter>
            </EditorHost>
          </FocusProvider>
        </TripProvider>
      </Suspense>,
    );
    expect(screen.getByRole("heading", { name: "Rome 2027" })).toBeTruthy();
    rackChunk.release();
    expect(await screen.findByTestId("rack-dock")).toBeTruthy();
    expect(routeFallbackShown).toBe(false);
  });
});
