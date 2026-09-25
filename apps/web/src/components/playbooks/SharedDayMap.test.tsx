import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SavedStop } from "@tc/contracts";
import { setViewportMatches } from "../../../vitest.setup";

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
const added: {
  sources: Record<string, unknown>;
  layers: AddedLayer[];
  markers: HTMLElement[];
  handlers: Map<string, (event: unknown) => void>;
} = {
  sources: {},
  layers: [],
  markers: [],
  handlers: new Map(),
};
// Set to make the next `new Map(...)` throw, the way maplibre does when there
// is no WebGL context — the failure that happens before any map exists.
const construction = { failNext: false };

vi.mock("maplibre-gl", () => {
  class FakeMap {
    constructor() {
      if (construction.failNext) {
        construction.failNext = false;
        throw new Error("Failed to initialize WebGL");
      }
    }
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
    on(event: string, handler: (event: unknown) => void) {
      added.handlers.set(event, handler);
    }
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
    mode: null,
    endLocation: null,
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
  added.handlers = new Map();
  construction.failNext = false;
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

/** Placed only at its city's centre — what the read-time backfill writes when a venue is not corroborated. */
function inCity(city: string, lat: number, lng: number, over: Partial<SavedStop> = {}): SavedStop {
  return stop({ ...over, location: { name: "Somewhere", city, lat, lng, precision: "city" } });
}

describe("SharedDayMap", () => {
  // **The frame is always there** (M27 link 10). SPEC §16 had this component
  // render nothing below two located stops; Mitchell retired that — "Every
  // playbook should have maps" — and then ruled out any state that changes the
  // frame's height, so the page never reflows. These replace the two tests
  // that asserted `innerHTML === ""`.
  it("holds the full-height frame, empty and saying so, when nothing can be placed", () => {
    render(<SharedDayMap savedDayId={DAY_ID} days={[{ dayIndex: 0, stops: [stop(), stop()] }]} scope="all" />);
    expect(screen.getByTestId("shared-day-map-frame")).toBeDefined();
    expect(screen.getByRole("heading", { name: "Nothing to map yet" })).toBeDefined();
    expect(
      screen.getByText("None of these stops has a place pinned to it, so there's no route to draw."),
    ).toBeDefined();
    expect(screen.queryByTestId("shared-day-map")).toBeNull();
  });

  it("holds the same frame, loading, while the server is pinning the stops", () => {
    render(
      <SharedDayMap savedDayId={DAY_ID} days={[{ dayIndex: 0, stops: [stop(), stop()] }]} scope="all" pinning />,
    );
    expect(screen.getByTestId("shared-day-map-frame")).toBeDefined();
    expect(screen.getByTestId("shared-day-map-loading")).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Nothing to map yet" })).toBeNull();
  });

  // **No reflow, as jsdom can see it.** jsdom has no layout, so the height
  // itself is measured in the browser lane (`m26-shared-day-map.spec.ts`
  // asserts the empty frame's 344px). What can be asserted here is the thing
  // that makes one height possible: the page keeps ONE frame element while
  // the state inside it changes — loading, then the map arriving, then the
  // scope moving to a day with nothing to place.
  it("keeps one frame element while its contents go from loading to a map to empty", async () => {
    const unplaced = [{ dayIndex: 0, stops: [stop(), stop()] }];
    const placed = [
      { dayIndex: 0, stops: [located(35.0, 135.7), located(35.02, 135.75)] },
      { dayIndex: 1, stops: [stop({ dayIndex: 1 })] },
    ];
    const { rerender } = render(<SharedDayMap savedDayId={DAY_ID} days={unplaced} scope="all" pinning />);
    const frame = screen.getByTestId("shared-day-map-frame");

    rerender(<SharedDayMap savedDayId={DAY_ID} days={placed} scope="all" />);
    expect(screen.getByTestId("shared-day-map-frame")).toBe(frame);
    expect(within(frame).getByTestId("shared-day-map")).toBeDefined();
    await settle();

    rerender(<SharedDayMap savedDayId={DAY_ID} days={placed} scope={1} />);
    expect(screen.getByTestId("shared-day-map-frame")).toBe(frame);
    expect(within(frame).getByRole("heading", { name: "Nothing to map yet" })).toBeDefined();
  });

  // A lone pin is something to place, so it is placed — with no line, and a
  // note that says why there is none.
  it("draws a lone located stop as a pin, with no route", async () => {
    render(
      <SharedDayMap
        savedDayId={DAY_ID}
        days={[{ dayIndex: 0, stops: [located(35.0, 135.7), stop()] }]}
        scope="all"
      />,
    );
    expect(screen.getByTestId("shared-day-map").getAttribute("aria-label")).toBe("Map of 1 located stop");
    await settle();
    expect(added.markers.map((m) => m.dataset.testid)).toEqual(["shared-day-pin"]);
    const geojson = added.sources["shared-day-route"] as { data: { features: unknown[] } };
    expect(geojson.data.features).toEqual([]);
    expect(
      within(screen.getByTestId("shared-day-map-panel")).getByText(
        "Only one stop is pinned so far, so there's no route to draw yet.",
      ),
    ).toBeDefined();
    expect(screen.queryByTestId("shared-day-map-legend")).toBeNull();
  });

  // **The city-level fallback.** Mitchell's own Playbook, after the backfill
  // could corroborate none of its venues: every stop at Kyoto's centre. One
  // disc for the city, no numbered pins stacked on it, no route.
  it("frames the city when the stops are placed only at its centre", async () => {
    render(
      <SharedDayMap
        savedDayId={DAY_ID}
        days={[
          { dayIndex: 0, stops: [inCity("Kyoto", 35.01, 135.77), inCity("Kyoto", 35.01, 135.77)] },
          { dayIndex: 1, stops: [inCity("Nara", 34.68, 135.8)] },
        ]}
        scope="all"
      />,
    );
    expect(screen.getByTestId("shared-day-map").getAttribute("aria-label")).toBe("Map of Kyoto, Nara");
    await settle();
    expect(added.markers.map((m) => [m.dataset.testid, m.dataset.city])).toEqual([
      ["shared-day-city", "Kyoto"],
      ["shared-day-city", "Nara"],
    ]);
    const geojson = added.sources["shared-day-route"] as { data: { features: unknown[] } };
    expect(geojson.data.features).toEqual([]);
    const panel = screen.getByTestId("shared-day-map-panel");
    expect(
      within(panel).getByText("The stops aren't pinned on the map yet — here's where the day happens."),
    ).toBeDefined();
    // No walking facts: there is no walk to measure.
    expect(within(panel).queryByText("Widest point to point")).toBeNull();
    expect(within(screen.getByTestId("shared-day-map-legend")).getByText("Somewhere in this city")).toBeDefined();
  });

  it("follows the day tabs: a day with nothing placeable shows the empty frame", () => {
    render(
      <SharedDayMap
        savedDayId={DAY_ID}
        days={[
          { dayIndex: 0, stops: [inCity("Kyoto", 35.01, 135.77)] },
          { dayIndex: 1, stops: [stop({ location: null, dayIndex: 1 })] },
        ]}
        scope={1}
      />,
    );
    expect(screen.getByRole("heading", { name: "Nothing to map yet" })).toBeDefined();
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

  // **Scoping to one day restarts the numbering at 1, because the LIST does.**
  // `SharedDayScreen` renders `dayScope === "all" ? stop.number :
  // group.stops.indexOf(stop) + 1`.
  //
  // This test previously asserted `["3", "4"]` — it was written from the
  // component's comment rather than from the screen it has to agree with, so it
  // passed while pinning the exact defect `sharedDayGeometry.ts` exists to
  // prevent: pins that disagree with the rows beside them. Found by CodeRabbit,
  // PR 196. A test agreeing with the code it tests, and both wrong together, is
  // the failure CLAUDE.md rule 3 is about.
  it("restarts numbering at 1 when scoped to the second day, as the list does", async () => {
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
    expect(added.markers.map((el) => el.textContent)).toEqual(["1", "2"]);
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

  // A ride is DOTTED, and the legend only offers "By train or taxi" when the
  // map is drawing one — the same `isRideLeg` decides both.
  it("draws a ride as its own layer and keys it in the legend", async () => {
    render(
      <SharedDayMap
        savedDayId={DAY_ID}
        days={[{ dayIndex: 0, stops: [located(35.0, 135.0), located(35.0, 135.1)] }]}
        scope="all"
      />,
    );
    await settle();
    expect(added.layers.map((l) => l.id)).toContain("shared-day-route-ride");
    const source = added.sources["shared-day-route"] as { data: { features: { properties: { ride: boolean } }[] } };
    expect(source.data.features.map((f) => f.properties.ride)).toEqual([true]);
    expect(screen.getByTestId("shared-day-map-legend").textContent).toContain("By train or taxi");
  });

  it("keys only On foot for a day walked end to end", async () => {
    render(
      <SharedDayMap
        savedDayId={DAY_ID}
        days={[{ dayIndex: 0, stops: [located(35.0, 135.0), located(35.0, 135.01)] }]}
        scope="all"
      />,
    );
    await settle();
    const legend = screen.getByTestId("shared-day-map-legend");
    expect(legend.textContent).toContain("On foot");
    expect(legend.textContent).not.toContain("By train or taxi");
  });
});

// `dc.html:1196-1226`: on a phone the route waits behind a "Show route" row.
// **The map's tiles and style come from a third party**, and no test may reach
// it — so what this file can hold is what a reader sees when it is down: the
// same offline panel the trip map uses, inside the same frame, with a way back.
// There are two ways in, and they are separate code: a LIVE map reporting a
// fatal error (`onFatalError`), and a map that never got built because the
// constructor threw (the effect's `.catch`).
describe("SharedDayMap when the map cannot load", () => {
  const placed = [{ dayIndex: 0, stops: [located(35.0, 135.7), located(35.02, 135.75)] }];

  it("swaps the map for the offline panel when the live map reports a fatal error, and Try again brings it back", async () => {
    const user = userEvent.setup({ delay: null });
    render(<SharedDayMap savedDayId={DAY_ID} days={placed} scope="all" />);
    await settle();
    expect(screen.queryByTestId("map-offline")).toBeNull();

    // A style failure, shaped the way maplibre delivers one (no `sourceId`,
    // a message naming the style) — `isFatalMapError` treats it as fatal.
    act(() => {
      added.handlers.get("error")!({ error: { message: "Failed to parse style" } });
    });

    const frame = screen.getByTestId("shared-day-map-frame");
    expect(within(frame).getByRole("heading", { name: "The map could not load" })).toBeDefined();
    expect(within(frame).queryByTestId("shared-day-map")).toBeNull();

    await user.click(within(frame).getByRole("button", { name: "Try again" }));
    expect(within(frame).getByTestId("shared-day-map")).toBeDefined();
    expect(within(frame).queryByTestId("map-offline")).toBeNull();
  });

  it("shows the offline panel, not a blank frame, when the map cannot even be built", async () => {
    construction.failNext = true;
    render(<SharedDayMap savedDayId={DAY_ID} days={placed} scope="all" />);
    expect(await screen.findByRole("heading", { name: "The map could not load" })).toBeDefined();
    expect(screen.queryByTestId("shared-day-map")).toBeNull();
  });
});

describe("SharedDayMap on a phone", () => {
  beforeEach(() => setViewportMatches({ "(max-width: 767px)": true }));
  afterEach(() => {
    cleanup();
    setViewportMatches({});
  });

  it("shows the route row closed, and builds the map only once it is opened", async () => {
    render(
      <SharedDayMap
        savedDayId={DAY_ID}
        days={[{ dayIndex: 0, stops: [located(35.0, 135.7), located(35.02, 135.75)] }]}
        scope="all"
      />,
    );
    const toggle = await screen.findByTestId("shared-day-route-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.textContent).toContain("Show route");
    expect(screen.queryByTestId("shared-day-map")).toBeNull();
    expect(added.markers).toHaveLength(0);

    await userEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("shared-day-map")).toBeDefined();
    await settle();
    expect(added.markers).toHaveLength(2);
  });

  // The phone keeps its "Show route" row in every state (Mitchell), and opening
  // it shows the same fixed-height frame the map would fill.
  it("keeps the route row with nothing to place, and opens onto the empty frame", async () => {
    render(<SharedDayMap savedDayId={DAY_ID} days={[{ dayIndex: 0, stops: [stop(), stop()] }]} scope="all" />);
    const toggle = await screen.findByTestId("shared-day-route-toggle");
    expect(toggle.textContent).toContain("Nothing to map yet");
    await userEvent.click(toggle);
    expect(within(screen.getByTestId("shared-day-map-frame")).getByRole("heading", { name: "Nothing to map yet" })).toBeDefined();
  });
});
