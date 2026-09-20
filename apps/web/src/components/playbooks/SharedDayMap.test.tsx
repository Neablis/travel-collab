import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SavedStop } from "@tc/contracts";

// MapLibre needs a WebGL context, which jsdom does not have, so the real module
// can never run here. The fake below is deliberately thin — it records what was
// asked of it and nothing more — because what is worth asserting in this
// environment is the DECISIONS (how many pins, which numbers, how many legs,
// whether anything is drawn at all), not MapLibre's own rendering.
//
// The map's *appearance* is not testable here and is not pretended to be: that
// is the browser lane's job, and this file would be lying if it claimed
// otherwise. What it does hold is the three rules `sharedDayGeometry.ts` was
// written for, now that they finally reach a screen.

type AddedLayer = { id: string; filter?: unknown };
const added: { sources: Record<string, unknown>; layers: AddedLayer[]; markers: HTMLElement[] } = {
  sources: {},
  layers: [],
  markers: [],
};

vi.mock("maplibre-gl", () => {
  class FakeMap {
    addSource(id: string, source: unknown) {
      added.sources[id] = source;
    }
    addLayer(layer: AddedLayer) {
      added.layers.push(layer);
    }
    getLayer() {
      return undefined;
    }
    getSource() {
      return undefined;
    }
    removeLayer() {}
    removeSource() {}
    isStyleLoaded() {
      return true;
    }
    on() {}
    once() {}
    resize() {}
    remove() {}
    hasImage() {
      return false;
    }
    addImage() {}
    fitBounds() {}
  }
  class FakeMarker {
    constructor(options: { element: HTMLElement }) {
      added.markers.push(options.element);
    }
    setLngLat() {
      return this;
    }
    addTo() {
      return this;
    }
    remove() {}
  }
  class FakeLngLatBounds {
    extend() {
      return this;
    }
  }
  return { Map: FakeMap, Marker: FakeMarker, LngLatBounds: FakeLngLatBounds, setWorkerUrl: () => {} };
});

import { SharedDayMap } from "./SharedDayMap";

const DAY_ID = "aa000000-0000-4000-8000-000000000001";

function stop(over: Partial<SavedStop> = {}): SavedStop {
  return {
    title: "Fushimi Inari at opening",
    timeWindow: null,
    location: { name: "Fushimi Inari Taisha", city: "Kyoto" },
    notes: null,
    anchors: [],
    kind: "planned",
    tags: [],
    cost: null,
    dayIndex: 0,
    ...over,
  };
}

/** A stop with real coordinates — the thing no fixture in this repo had. */
function located(lat: number, lng: number, over: Partial<SavedStop> = {}): SavedStop {
  return stop({ ...over, location: { name: "Somewhere", city: "Kyoto", lat, lng } });
}

beforeEach(() => {
  added.sources = {};
  added.layers = [];
  added.markers = [];
  // jsdom has no ResizeObserver, and `createBaseMap` installs one for the
  // 0×0-tile-cover fix. Without this stub the component throws on mount — and
  // it threw silently the first time this file was run, which is why the stub
  // is here rather than in a shared setup nobody would connect to the cause.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Waits for the dynamic `import("maplibre-gl")` inside the mount effect. */
async function settle() {
  await vi.waitFor(() => expect(added.markers.length + added.layers.length).toBeGreaterThan(0));
}

describe("SharedDayMap", () => {
  // SPEC §16: below two located stops the surface degrades to LIST-ONLY. One
  // pin on a world map tells a reader less than the city name in the list does.
  it("draws nothing when only one stop has coordinates", () => {
    const { container } = render(
      <SharedDayMap
        savedDayId={DAY_ID}
        days={[{ dayIndex: 0, stops: [located(35.0, 135.7), stop()] }]}
        scope="all"
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("draws nothing when no stop has coordinates at all", () => {
    const { container } = render(
      <SharedDayMap savedDayId={DAY_ID} days={[{ dayIndex: 0, stops: [stop(), stop()] }]} scope="all" />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders a map once two stops are located", async () => {
    render(
      <SharedDayMap
        savedDayId={DAY_ID}
        days={[{ dayIndex: 0, stops: [located(35.0, 135.7), located(35.02, 135.75)] }]}
        scope="all"
      />,
    );
    // `getBy*` throws when absent, so this is the presence assertion (the lint
    // rule prefers it over `queryBy*` + a null check, and is right: the thrown
    // message names the missing testid, where `expected null not to be null`
    // would not).
    expect(screen.getByTestId("shared-day-map")).toBeDefined();
    await settle();
    expect(added.markers).toHaveLength(2);
  });

  // **The pins carry the LIST's numbers.** `playbookDays` numbers across the
  // whole Playbook with a running counter, so day 2 starts at 5 when day 1 held
  // four stops — and a map that renumbered from 1 inside a day would put pin 1
  // beside the list's row 5. This is the assertion that holds them together.
  it("numbers pins continuously across days, as the list does", async () => {
    render(
      <SharedDayMap
        savedDayId={DAY_ID}
        days={[
          { dayIndex: 0, stops: [located(35.0, 135.7), located(35.01, 135.71)] },
          { dayIndex: 1, stops: [located(34.7, 135.5), located(34.71, 135.51)] },
        ]}
        scope="all"
      />,
    );
    await settle();
    expect(added.markers.map((el) => el.textContent)).toEqual(["1", "2", "3", "4"]);
  });

  // Rule 2 of `sharedDayGeometry.ts`: **no leg may join the last stop of one
  // day to the first of the next.** A straight line across a night is a fact
  // the map would be inventing — nobody walked it, and the line says they did.
  it("never draws a leg across a night", async () => {
    render(
      <SharedDayMap
        savedDayId={DAY_ID}
        days={[
          { dayIndex: 0, stops: [located(35.0, 135.7), located(35.01, 135.71)] },
          { dayIndex: 1, stops: [located(34.7, 135.5), located(34.71, 135.51)] },
        ]}
        scope="all"
      />,
    );
    await settle();
    const source = added.sources["shared-day-route"] as { data: { features: unknown[] } };
    // Two days of two stops each: one leg per day, and NOT three.
    expect(source.data.features).toHaveLength(2);
  });

  // Scoping to a day keeps the list's numbering rather than restarting at 1.
  it("keeps whole-Playbook numbering when scoped to the second day", async () => {
    render(
      <SharedDayMap
        savedDayId={DAY_ID}
        days={[
          { dayIndex: 0, stops: [located(35.0, 135.7), located(35.01, 135.71)] },
          { dayIndex: 1, stops: [located(34.7, 135.5), located(34.71, 135.51)] },
        ]}
        scope={1}
      />,
    );
    await settle();
    expect(added.markers.map((el) => el.textContent)).toEqual(["3", "4"]);
  });

  // A leg that skipped an unlocated stop is drawn dashed, because the line
  // between its ends is a guess about a route that missed something out.
  it("separates contiguous legs from gapped ones into two layers", async () => {
    render(
      <SharedDayMap
        savedDayId={DAY_ID}
        days={[{ dayIndex: 0, stops: [located(35.0, 135.7), stop(), located(35.02, 135.75)] }]}
        scope="all"
      />,
    );
    await settle();
    const ids = added.layers.map((l) => l.id);
    expect(ids).toContain("shared-day-route-solid");
    expect(ids).toContain("shared-day-route-gapped");
    const source = added.sources["shared-day-route"] as {
      data: { features: { properties: { contiguous: boolean } }[] };
    };
    expect(source.data.features.map((f) => f.properties.contiguous)).toEqual([false]);
  });
});
