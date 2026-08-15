import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TripDetail } from "@tc/contracts";
import { EditorHost } from "@/components/trip/context/EditorHost";
import { tripDetailFixture } from "@/mocks/fixtures";
import { MapLens } from "./MapLens";

// MapLens dynamically imports maplibre-gl, whose real module init touches
// browser APIs jsdom doesn't implement (window.URL.createObjectURL, WebGL),
// producing an unhandled rejection that fails the CI exit code even though
// all assertions pass. Mock it with a minimal stub covering every method
// MapLens actually calls, so the dynamic import resolves cleanly and never
// touches a real browser API.
//
// `vi.hoisted` because `vi.mock` factories run before the rest of the module
// evaluates — these spies need to exist by the time the factory closure
// captures them, and also be importable by the tests below to assert on.
const { addLayerMock, addSourceMock, fitBoundsMock, mapOnLoad, setPaintPropertyMock } = vi.hoisted(() => ({
  addLayerMock: vi.fn(),
  addSourceMock: vi.fn(),
  fitBoundsMock: vi.fn(),
  mapOnLoad: vi.fn(),
  setPaintPropertyMock: vi.fn(),
}));

vi.mock("maplibre-gl", () => {
  class Marker {
    setLngLat() {
      return this;
    }
    addTo() {
      return this;
    }
    getElement() {
      return document.createElement("div");
    }
  }
  class LngLatBounds {
    extend() {
      return this;
    }
  }
  class Map {
    on(event: string, cb: () => void) {
      // Real maplibre fires "load" async, after style/tiles resolve — a
      // microtask keeps that ordering (and satisfies the `await waitFor`
      // callers below) without an unawaited real network/GL round-trip.
      if (event === "load") {
        Promise.resolve().then(() => {
          mapOnLoad();
          cb();
        });
      }
    }
    addSource(...args: unknown[]) {
      addSourceMock(...args);
    }
    addLayer(...args: unknown[]) {
      addLayerMock(...args);
    }
    setPaintProperty(...args: unknown[]) {
      setPaintPropertyMock(...args);
    }
    getLayer() {
      return undefined;
    }
    resize() {}
    fitBounds(...args: unknown[]) {
      fitBoundsMock(...args);
    }
    remove() {}
  }
  return { Map, Marker, LngLatBounds };
});

const useFocusMock = vi.fn();
vi.mock("@/components/trip/context/FocusProvider", () => ({
  useFocus: () => useFocusMock(),
}));

function detailFixture() {
  return tripDetailFixture({
    days: [{ dayId: "d1", activityIds: ["located1", "unlocated1"], date: "2027-06-01", costSubtotal: 0 }],
    backlog: ["unlocated2"],
    activities: {
      located1: {
        activityId: "located1",
        title: "Colosseum tour",
        timeWindow: { start: "09:00", end: "11:00" },
        location: { name: "Colosseum, Rome, Italy", lat: 41.8902, lng: 12.4922, countryCode: "IT" },
        notes: null,
        anchors: [],
        cost: null,
      },
      unlocated1: {
        activityId: "unlocated1",
        title: "Pack bags",
        timeWindow: null,
        location: null,
        notes: null,
        anchors: [],
        cost: null,
      },
      unlocated2: {
        activityId: "unlocated2",
        title: "Book flight",
        timeWindow: null,
        location: null,
        notes: null,
        anchors: [],
        cost: null,
      },
    },
  });
}

function locatedActivity(id: string, lat: number, lng: number) {
  return {
    activityId: id,
    title: id,
    timeWindow: null,
    location: { name: id, lat, lng },
    notes: null,
    anchors: [],
    cost: null,
  };
}

function detailWithTwoDays(): TripDetail {
  return tripDetailFixture({
    days: [
      { dayId: "d1", activityIds: ["a1", "a2"], date: "2027-06-01", costSubtotal: 0 },
      { dayId: "d2", activityIds: ["b1", "b2"], date: "2027-06-02", costSubtotal: 0 },
    ],
    activities: {
      a1: locatedActivity("a1", 41.89, 12.49),
      a2: locatedActivity("a2", 41.9, 12.48),
      b1: locatedActivity("b1", 43.15, -77.6),
      b2: locatedActivity("b2", 43.16, -77.62),
    },
  });
}

function detailWithEmptyDay(): TripDetail {
  return tripDetailFixture({
    days: [
      { dayId: "d1", activityIds: ["a1", "a2"], date: "2027-06-01", costSubtotal: 0 },
      { dayId: "d2", activityIds: ["b1", "b2"], date: "2027-06-02", costSubtotal: 0 },
      { dayId: "d3", activityIds: [], date: "2027-06-03", costSubtotal: 0 },
    ],
    activities: {
      a1: locatedActivity("a1", 41.89, 12.49),
      a2: locatedActivity("a2", 41.9, 12.48),
      b1: locatedActivity("b1", 43.15, -77.6),
      b2: locatedActivity("b2", 43.16, -77.62),
    },
  });
}

function renderMap(detail: TripDetail, overrides: { focusedDay?: number | null; setFocusedDay?: (i: number | null) => void } = {}) {
  useFocusMock.mockReturnValue({ focusedDay: null, setFocusedDay: vi.fn(), ...overrides });
  return render(
    <EditorHost>
      <MapLens detail={detail} onSelectActivity={vi.fn()} />
    </EditorHost>,
  );
}

describe("MapLens", () => {
  it("shows no located-activities list; unlocated activities get a compact affordance", () => {
    const onSelectActivity = vi.fn();
    useFocusMock.mockReturnValue({ focusedDay: null, setFocusedDay: vi.fn() });
    const { container } = render(
      <EditorHost>
        <MapLens detail={detailFixture()} onSelectActivity={onSelectActivity} />
      </EditorHost>,
    );

    expect(container.querySelector(".map-lens-pin-list")).toBeNull();

    const affordance = screen.getByRole("button", { name: /2 activities have no location/i });
    expect(affordance).toBeTruthy();

    fireEvent.click(affordance);
    expect(onSelectActivity).toHaveBeenCalledWith("unlocated1");
  });

  it("draws one route layer per day that has two or more located stops", async () => {
    renderMap(detailWithTwoDays());
    await waitFor(() => expect(addLayerMock).toHaveBeenCalled());

    const lineLayers = addLayerMock.mock.calls.filter(([layer]) => (layer as { type: string }).type === "line");
    expect(lineLayers).toHaveLength(2);
  });

  it("does not move the camera for a focused day with no coordinates", async () => {
    renderMap(detailWithEmptyDay(), { focusedDay: 2 });
    await waitFor(() => expect(mapOnLoad).toHaveBeenCalled());

    expect(fitBoundsMock).not.toHaveBeenCalled();
  });
});
