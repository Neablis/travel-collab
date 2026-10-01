import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { tripDetailFixture } from "@tc/factories";
import { EditorHost } from "@/components/trip/context/EditorHost";
import { MapLens } from "./MapLens";

// Its own file because the failure is in the IMPORT: `MapLens.test.tsx` mocks
// maplibre-gl with a working stub, and a module mock is fixed for the whole
// file. A factory that throws makes `import("maplibre-gl")` reject, which is
// what a chunk that never arrives does in a browser.
vi.mock("maplibre-gl", () => {
  throw new Error("Loading chunk maplibre-gl failed");
});

vi.mock("@/components/trip/context/FocusProvider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/trip/context/FocusProvider")>()),
  useFocus: () => ({
    focusedDay: null,
    setFocusedDay: vi.fn(),
    focusedTag: null,
    toggleFocusedTag: vi.fn(),
    clearFocusedTag: vi.fn(),
  }),
  useDaySync: () => ({ shouldFollow: true, isOwnScroll: () => false, reportScrolled: vi.fn(), jumpTo: () => false }),
}));

it("shows the offline panel at once when the map library fails to load, rather than a blank canvas", async () => {
  const detail = tripDetailFixture({
    days: [{ dayId: "d1", activityIds: ["a1"], date: "2027-06-01", costSubtotal: 0 }],
    activities: {
      a1: {
        activityId: "a1",
        title: "Colosseum tour",
        timeWindow: null,
        location: { name: "Colosseum", city: "Rome", lat: 41.8902, lng: 12.4922, countryCode: "IT" },
        notes: null,
        anchors: [],
        kind: "planned" as const,
        tags: [],
        cost: null,
        bookedBy: null,
        participants: [],
        mode: null,
        endLocation: null,
        pendingReason: null,
      },
    },
  });
  render(
    <EditorHost>
      <MapLens detail={detail} onSelectActivity={vi.fn()} />
    </EditorHost>,
  );

  // `findBy` waits 1s; the ladder's first rung is 3.5s and its fall-back 11s,
  // so this can only pass if the rejection itself raised the panel.
  expect(await screen.findByTestId("map-offline")).toBeTruthy();
});
