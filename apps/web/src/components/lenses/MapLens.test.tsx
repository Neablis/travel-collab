import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EditorHost } from "@/components/trip/context/EditorHost";
import { tripDetailFixture } from "@/mocks/fixtures";
import { MapLens } from "./MapLens";

// MapLens dynamically imports maplibre-gl, whose real module init touches
// browser APIs jsdom doesn't implement (window.URL.createObjectURL, WebGL),
// producing an unhandled rejection that fails the CI exit code even though
// all assertions pass. Mock it with a minimal stub covering every method
// MapLens actually calls, so the dynamic import resolves cleanly and never
// touches a real browser API.
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
    on() {}
    fitBounds() {}
    remove() {}
  }
  return { Map, Marker, LngLatBounds };
});

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

describe("MapLens", () => {
  it("shows no located-activities list; unlocated activities get a compact affordance", () => {
    const onSelectActivity = vi.fn();
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
});
