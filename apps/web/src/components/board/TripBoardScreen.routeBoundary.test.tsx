import { Suspense } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { costedTripDetailFixture } from "@tc/factories";
import { makeAccountPlanHandler, makeNearbyStopsHandler, makeTripHandlers } from "@/mocks/handlers";
import { tripFirstDataFixture } from "@/test-support/tripFirstData";

// PR 486 e2e (m46-trip-chat): **nothing the board mounts may suspend to the
// ROUTE's boundary.** The page sits in `(board)/loading.tsx`'s Suspense. A
// `next/dynamic` with no `loading` has no Suspense boundary of its own in the
// app router, so while its chunk was on the wire it suspended to the route's,
// and React hid the whole server-rendered board (`display: none`) behind the
// loading skeleton. The rack's dock did this as it mounted after hydration
// (the Ask pill lost its box), and the stop editor did it on a first Add stop.
//
// Two things this file does that the board's own suite cannot:
// - `next/dynamic` is the app router's. A build aliases it to
//   `next/dist/api/app-dynamic` (`create-compiler-aliases.js`), which is a
//   re-export of `shared/lib/app-dynamic` — `React.lazy`, and a boundary only
//   with a `loading` or `ssr: false`. Under vitest the bare specifier resolves
//   to the pages router's loadable, which never suspends.
// - a chunk is genuinely pending: its import waits on a gate. A warmed module
//   never is, because React replays a lazy whose promise has settled. Each
//   test gets fresh gates and a fresh module graph (`vi.resetModules`), so its
//   lazies are its own and its chunks really are pending.
//
// Rendered with `render`, not hydrated: on a client render `useHydrated` is
// already true, so the dock mounts on the first render, which is the same
// mount the hydrated page makes a moment after hydrating.

const gates = vi.hoisted(() => {
  const deferred = () => {
    let release: () => void = () => {};
    const promise = new Promise<void>((resolve) => (release = resolve));
    return { promise, release };
  };
  return { deferred, rack: deferred(), editor: deferred() };
});

vi.mock("next/dynamic", async () => {
  const appDynamic = await vi.importActual<{ default?: unknown }>("next/dist/api/app-dynamic.js");
  return { default: appDynamic.default ?? appDynamic };
});
vi.mock("@/components/trip/UnscheduledRack", async () => {
  await gates.rack.promise;
  return vi.importActual("@/components/trip/UnscheduledRack");
});
vi.mock("@/components/trip/editor/ActivityEditorSheet", async () => {
  await gates.editor.promise;
  return vi.importActual("@/components/trip/editor/ActivityEditorSheet");
});
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("view=Plan"),
  usePathname: () => "/trips/x",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

const first = tripFirstDataFixture({ trip: costedTripDetailFixture() });
const tripId = first.trip.trip.tripId;
const server = setupServer(
  ...makeTripHandlers(first.trip.trip),
  makeAccountPlanHandler(),
  makeNearbyStopsHandler([]),
  http.get("/api/v1/trips/:tripId/guests", () => HttpResponse.json({ items: [] })),
);
beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
beforeEach(() => {
  gates.rack = gates.deferred();
  gates.editor = gates.deferred();
  vi.resetModules();
});
afterEach(() => {
  cleanup();
  gates.rack.release();
  gates.editor.release();
});
afterAll(() => server.close());

/** The seeded board inside a boundary standing in for the route's, from a fresh module graph. */
async function renderInRoute() {
  const { TripBoardScreen } = await import("./TripBoardScreen");
  const { TripProvider } = await import("@/components/trip/context/TripProvider");
  const { FocusProvider } = await import("@/components/trip/context/FocusProvider");
  const { EditorHost, useEditor } = await import("@/components/trip/context/EditorHost");
  const { LensRouter } = await import("@/components/trip/context/LensRouter");
  const shown = { routeFallback: false };
  function RouteFallback() {
    shown.routeFallback = true;
    return null;
  }
  function OpenEditor() {
    const { openCreate } = useEditor();
    return <button onClick={() => openCreate()}>open the editor</button>;
  }
  render(
    <Suspense fallback={<RouteFallback />}>
      <TripProvider tripId={tripId} initial={first}>
        <FocusProvider>
          <EditorHost>
            <LensRouter>
              <TripBoardScreen tripId={tripId} />
              <OpenEditor />
            </LensRouter>
          </EditorHost>
        </FocusProvider>
      </TripProvider>
    </Suspense>,
  );
  return shown;
}

describe("TripBoardScreen — inside the route's Suspense boundary", () => {
  it("never falls back to the route's boundary while the rack's chunk loads", async () => {
    const shown = await renderInRoute();
    expect(shown.routeFallback).toBe(false);
    expect(screen.getByRole("heading", { name: "Rome 2027" })).toBeTruthy();
    gates.rack.release();
    expect(await screen.findByTestId("rack-dock")).toBeTruthy();
    expect(shown.routeFallback).toBe(false);
  });

  it("never falls back to the route's boundary while the stop editor's chunk loads", async () => {
    gates.rack.release();
    const shown = await renderInRoute();
    expect(await screen.findByTestId("rack-dock")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "open the editor" }));
    expect(shown.routeFallback).toBe(false);
    expect(screen.getByRole("heading", { name: "Rome 2027" })).toBeTruthy();
    gates.editor.release();
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(shown.routeFallback).toBe(false);
  });
});
