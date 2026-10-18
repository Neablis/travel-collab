import { useSyncExternalStore } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { costedTripDetailFixture } from "@tc/factories";
import { makeAccountPlanHandler, makeNearbyStopsHandler, makeTripHandlers } from "@/mocks/handlers";
import { tripFirstDataFixture } from "@/test-support/tripFirstData";

// PR 486 e2e (m26-phone-plan): **a phone's Plan is first drawn in its right
// form.** The board renders on the server, and its lens mounts once the page
// is live. Two things a phone's Plan reads were not settled by then, and each
// put the river on screen in a form that moved a moment later:
//
// - `useIsPhone` corrects in an effect, so a lens mounted when the page went
//   live drew a phone's Plan in its desktop form (all its day columns);
// - the phone's arrival day (Day 1) is focused in an effect too, and the card
//   it draws moved the page under a finger already on the river.
//
// Both are held here at the point the browser is in between, which a real
// render races through: the width hook still guessing, then the arrival day
// not yet applied. In each the lens must not be mounted yet.

const widths = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return {
    isPhone: false,
    listeners,
    set(isPhone: boolean) {
      this.isPhone = isPhone;
      listeners.forEach((listener) => listener());
    },
  };
});
vi.mock("@/lib/useIsPhone", async (orig) => {
  const actual = await orig<typeof import("@/lib/useIsPhone")>();
  return {
    ...actual,
    // A phone, known from the first client render, as `matchMedia` answers it.
    useIsPhoneKnown: () => true,
    // `useIsPhone`'s state, which a test moves where its effect would.
    useIsPhone: () =>
      useSyncExternalStore(
        (onChange) => {
          widths.listeners.add(onChange);
          return () => widths.listeners.delete(onChange);
        },
        () => widths.isPhone,
        () => false,
      ),
  };
});

// The arrival day, held: `setFocusedDay` is queued while `held`.
const focus = vi.hoisted(() => ({ held: false, queued: [] as (() => void)[] }));
vi.mock("@/components/trip/context/FocusProvider", async (orig) => {
  const actual = await orig<typeof import("@/components/trip/context/FocusProvider")>();
  return {
    ...actual,
    useFocus: () => {
      const value = actual.useFocus();
      return {
        ...value,
        setFocusedDay: (...args: Parameters<typeof value.setFocusedDay>) => {
          if (focus.held) focus.queued.push(() => value.setFocusedDay(...args));
          else value.setFocusedDay(...args);
        },
      };
    },
  };
});

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("view=Plan"),
  usePathname: () => "/trips/x",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

import { TripBoardScreen, preloadTripBoardModules } from "./TripBoardScreen";
import { TripProvider } from "@/components/trip/context/TripProvider";
import { FocusProvider } from "@/components/trip/context/FocusProvider";
import { EditorHost } from "@/components/trip/context/EditorHost";
import { LensRouter } from "@/components/trip/context/LensRouter";

const first = tripFirstDataFixture({ trip: costedTripDetailFixture() });
const tripId = first.trip.trip.tripId;
const server = setupServer(
  ...makeTripHandlers(first.trip.trip),
  makeAccountPlanHandler(),
  makeNearbyStopsHandler([]),
  http.get("/api/v1/trips/:tripId/guests", () => HttpResponse.json({ items: [] })),
);
beforeAll(async () => {
  server.listen({ onUnhandledRequest: "bypass" });
  await preloadTripBoardModules();
});
beforeEach(() => {
  // The focused day is remembered for the session; each test arrives fresh.
  sessionStorage.clear();
  widths.isPhone = false;
  focus.held = false;
  focus.queued = [];
});
afterEach(cleanup);
afterAll(() => server.close());

// A fresh answer each time, as each server render is: a provider adopts an
// answer once per document (`firstDataSpent`).
const renderBoard = () =>
  render(
    <TripProvider tripId={tripId} initial={tripFirstDataFixture({ trip: first.trip.trip })}>
      <FocusProvider>
        <EditorHost>
          <LensRouter>
            <TripBoardScreen tripId={tripId} />
          </LensRouter>
        </EditorHost>
      </FocusProvider>
    </TripProvider>,
  );

describe("TripBoardScreen — a phone's Plan is first drawn in its right form", () => {
  it("does not mount the lens while the width hook still guesses desktop", async () => {
    renderBoard();
    expect(screen.getByTestId("lens-placeholder")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Day columns" })).toBeNull();
    // The header is live meanwhile: only the lens waits for the width (PR 486
    // e2e, m39-phone-conflicts focused a header control in this window).
    expect(screen.getByTestId("trip-board-content").hasAttribute("inert")).toBe(false);
    // The rack waits with the lens: on a phone it is a row in the board, and
    // the desktop dock would be the wrong form.
    expect(screen.queryByTestId("rack-dock")).toBeNull();
    act(() => widths.set(true));
    expect(await screen.findByRole("group", { name: "Day columns" })).toBeTruthy();
    expect(screen.queryByTestId("lens-placeholder")).toBeNull();
  });

  // Once live, for good (PR 486 review): a rotation across 768px re-renders
  // the media query before `useIsPhone` follows, and for that commit the two
  // disagree again. The lens must not be unmounted and mounted again.
  it("keeps the lens mounted when the width hooks disagree after it went live", async () => {
    widths.isPhone = true;
    renderBoard();
    const columns = await screen.findByRole("group", { name: "Day columns" });
    act(() => widths.set(false));
    expect(screen.queryByTestId("lens-placeholder")).toBeNull();
    expect(screen.getByRole("group", { name: "Day columns" })).toBe(columns);
  });

  it("does not mount the lens until the phone's arrival day is focused", async () => {
    widths.isPhone = true;
    focus.held = true;
    renderBoard();
    expect(focus.queued.length).toBeGreaterThan(0);
    expect(screen.getByTestId("lens-placeholder")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Day columns" })).toBeNull();
    expect(screen.getByTestId("trip-board-content").hasAttribute("inert")).toBe(false);
    act(() => focus.queued.forEach((apply) => apply()));
    expect(await screen.findByRole("group", { name: "Day columns" })).toBeTruthy();
  });
});
