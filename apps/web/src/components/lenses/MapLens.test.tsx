import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TripDetail } from "@tc/contracts";
import { EditorHost } from "@/components/trip/context/EditorHost";
import { tripDetailFixture } from "@tc/factories";
import { MapLens } from "./MapLens";
import { MAP_RAIL_INSET_PX, MAP_RAIL_WIDTH_PX } from "./MapRail";

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
const { addLayerMock, addSourceMock, fitBoundsMock, mapConstructorMock, mapOnLoad, setPaintPropertyMock, markerInstances } = vi.hoisted(
  () => ({
    addLayerMock: vi.fn(),
    addSourceMock: vi.fn(),
    fitBoundsMock: vi.fn(),
    mapConstructorMock: vi.fn(),
    mapOnLoad: vi.fn(),
    setPaintPropertyMock: vi.fn(),
    // Real maplibre's Marker#getElement() returns the *same* DOM node on
    // every call — this array of constructed instances (each with a stable
    // element) lets a test find "the marker for stop N" and assert on the
    // opacity MapLens applies to its element, mirroring how it asserts on
    // route-layer opacity via setPaintPropertyMock above.
    markerInstances: [] as { element: HTMLDivElement; getElement: () => HTMLDivElement }[],
  }),
);

vi.mock("maplibre-gl", () => {
  class Marker {
    element = document.createElement("div");
    constructor() {
      markerInstances.push(this);
    }
    setLngLat() {
      return this;
    }
    addTo() {
      return this;
    }
    getElement() {
      return this.element;
    }
    // Real maplibre doesn't accept a direct `element.style.opacity` write as
    // the source of truth — Marker owns an internal _opacity field that its
    // own render-driven _updateOpacity() reapplies to the DOM on every map
    // render, silently reverting any out-of-band style write (confirmed
    // live: a direct style.opacity assignment took effect for one frame,
    // then reverted to full strength on the map's next render pass). Only
    // Marker#setOpacity feeds that internal field, so MapLens calls this
    // method, not element.style.opacity, to ghost/un-ghost a marker — this
    // stub applies it to the element the same way, so assertions on
    // getElement().style.opacity below still reflect what MapLens set.
    setOpacity(opacity: string) {
      this.element.style.opacity = opacity;
      return this;
    }
  }
  class LngLatBounds {
    extend() {
      return this;
    }
  }
  class Map {
    constructor(options: unknown) {
      mapConstructorMock(options);
    }
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
        location: { name: "Colosseum, Rome, Italy", city: "Rome", lat: 41.8902, lng: 12.4922, countryCode: "IT" },
        notes: null,
        anchors: [],
        kind: "planned" as const,
        tags: [],
        cost: null,
      },
      unlocated1: {
        activityId: "unlocated1",
        title: "Pack bags",
        timeWindow: null,
        location: null,
        notes: null,
        anchors: [],
        kind: "planned" as const,
        tags: [],
        cost: null,
      },
      unlocated2: {
        activityId: "unlocated2",
        title: "Book flight",
        timeWindow: null,
        location: null,
        notes: null,
        anchors: [],
        kind: "planned" as const,
        tags: [],
        cost: null,
      },
    },
  });
}

// `city` defaults to the id so each fixture day derives a distinct city, which
// is what `dayAccents` colours the routes by. It used to come out of the
// `?? name` fallback that grouping no longer does; naming it here keeps these
// route-colour tests about colour rather than about city derivation.
function locatedActivity(id: string, lat: number, lng: number, city = id) {
  return {
    activityId: id,
    title: id,
    timeWindow: null,
    location: { name: id, city, lat, lng },
    notes: null,
    anchors: [],
    kind: "planned" as const,
    tags: [],
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

function detailWithBacklogPin(): TripDetail {
  return tripDetailFixture({
    days: [{ dayId: "d1", activityIds: ["a1", "a2"], date: "2027-06-01", costSubtotal: 0 }],
    backlog: ["c1"],
    activities: {
      a1: locatedActivity("a1", 41.89, 12.49),
      a2: locatedActivity("a2", 41.9, 12.48),
      // Located, but not on any day — a "backlog-located" activity, which the
      // map no longer plots at all (Mitchell, preview review, 2026-08-25).
      c1: locatedActivity("c1", 40.0, 10.0),
    },
  });
}

// Backlog pin declared before the day-attached one, so Object.entries (the
// iteration order activityPins relies on) yields it first — reproducing the
// CodeRabbit-flagged bug where an unfiltered pins[0] centred the map on a
// backlog stop the map deliberately never draws.
function detailWithBacklogPinSortingFirst(): TripDetail {
  return tripDetailFixture({
    days: [{ dayId: "d1", activityIds: ["a1"], date: "2027-06-01", costSubtotal: 0 }],
    backlog: ["c1"],
    activities: {
      c1: locatedActivity("c1", 40.0, 10.0),
      a1: locatedActivity("a1", 41.89, 12.49),
    },
  });
}

function detailWithBacklogPinOnly(): TripDetail {
  return tripDetailFixture({
    days: [{ dayId: "d1", activityIds: [], date: "2027-06-01", costSubtotal: 0 }],
    backlog: ["c1"],
    activities: {
      c1: locatedActivity("c1", 40.0, 10.0),
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
  it("shows no located-activities list; only a day-attached unlocated activity gets the compact affordance", () => {
    // detailFixture()'s unlocated2 is backlog-only (no day) — scoped out per
    // Mitchell's preview-review call: the map doesn't plot the backlog, so it
    // shouldn't nag about the backlog's missing locations either. Only
    // unlocated1 (on d1) counts.
    const onSelectActivity = vi.fn();
    useFocusMock.mockReturnValue({ focusedDay: null, setFocusedDay: vi.fn() });
    const { container } = render(
      <EditorHost>
        <MapLens detail={detailFixture()} onSelectActivity={onSelectActivity} />
      </EditorHost>,
    );

    expect(container.querySelector(".map-lens-pin-list")).toBeNull();

    const affordance = screen.getByRole("button", { name: /1 activity has no location/i });
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

  it("jumps the camera to a focused day's bounds instantly, with no glide animation", async () => {
    renderMap(detailWithTwoDays(), { focusedDay: 0 });
    await waitFor(() => expect(fitBoundsMock).toHaveBeenCalled());

    const [, options] = fitBoundsMock.mock.calls[0]!;
    expect((options as { animate?: boolean }).animate).toBe(false);
  });

  it("pads fitBounds asymmetrically so the left rail can't cover a focused day's pins", async () => {
    fitBoundsMock.mockClear();
    renderMap(detailWithTwoDays(), { focusedDay: 0 });
    await waitFor(() => expect(fitBoundsMock).toHaveBeenCalled());

    // .at(-1): fitBoundsMock accumulates across this file's tests (nothing
    // clears it globally — same reason setPaintPropertyMock's own tests
    // mockClear() themselves above), so the freshest call is this render's.
    const [, options] = fitBoundsMock.mock.calls.at(-1)!;
    const padding = (options as { padding: { top: number; right: number; bottom: number; left: number } }).padding;
    expect(padding.top).toBe(100);
    expect(padding.right).toBe(100);
    expect(padding.bottom).toBe(100);
    // The left side alone clears the rail's own footprint (inset + width),
    // on top of the same 100px breathing room every other side keeps.
    expect(padding.left).toBe(MAP_RAIL_INSET_PX + MAP_RAIL_WIDTH_PX + 100);
  });

  it("starts a little more zoomed out than before, so a pin near the left edge has a better chance of clearing the rail", () => {
    renderMap(detailWithTwoDays());

    const [options] = mapConstructorMock.mock.calls.at(-1)!;
    expect((options as { zoom: number }).zoom).toBe(9);
  });

  it("centres the initial camera on the first day-attached pin, never a backlog pin that sorts first", async () => {
    mapConstructorMock.mockClear();
    renderMap(detailWithBacklogPinSortingFirst());
    await waitFor(() => expect(mapConstructorMock).toHaveBeenCalled());

    const [options] = mapConstructorMock.mock.calls.at(-1)!;
    // a1 (day-attached), not c1 (backlog) despite c1 being declared first —
    // a backlog stop is never drawn, so it must never drive the centre either.
    expect((options as { center: [number, number] }).center).toEqual([12.49, 41.89]);
  });

  it("renders the empty state, not a blank canvas, when every located activity is backlog-only", () => {
    // A backlog-only pin must never reach the "construct a map" branch at
    // all — the effect's `if (!firstPin) return` guard runs synchronously,
    // before the maplibre-gl dynamic import, so this is deterministic with
    // no waitFor needed.
    const callsBefore = mapConstructorMock.mock.calls.length;
    const { container } = renderMap(detailWithBacklogPinOnly());

    expect(screen.getByText(/no located activities yet/i)).toBeTruthy();
    expect(container.querySelector(".map-lens-canvas")).toBeNull();
    expect(mapConstructorMock.mock.calls.length).toBe(callsBefore);
  });

  describe("route ghosting on focus", () => {
    it("dims the non-focused day's route further than a faint fade and gives it a neutral colour", async () => {
      // detailWithTwoDays()'s d1/d2 hash to the "danger"/"success" accent
      // families respectively (derived from each day's first stop id, "a1"
      // and "b1" — see dayAccents' djb2 hash; with only two distinct cities
      // here, neither collides, so each keeps its raw hash bucket same as
      // before Task 8.2's probing was added). The actual values don't
      // matter — only that each token resolves to something distinct — so
      // opaque markers stand in for real hex colours (the color-wall script
      // forbids raw color literals outside globals.css, tests included).
      document.documentElement.style.setProperty("--color-danger", "TEST-DANGER");
      document.documentElement.style.setProperty("--color-success", "TEST-SUCCESS");
      document.documentElement.style.setProperty("--color-slate", "TEST-SLATE");
      // setPaintPropertyMock accumulates calls across every test in this
      // file (nothing clears it between tests) — clear it so the upcoming
      // waitFor genuinely waits for THIS render's own calls, instead of
      // resolving instantly against a leftover call from an earlier test.
      setPaintPropertyMock.mockClear();

      renderMap(detailWithTwoDays(), { focusedDay: 0 });
      await waitFor(() => expect(setPaintPropertyMock).toHaveBeenCalled());

      const lastCall = (layerId: string, prop: string) =>
        setPaintPropertyMock.mock.calls.filter((c) => c[0] === layerId && c[1] === prop).at(-1)!;

      const focusedOpacity = lastCall("route-d1", "line-opacity");
      const ghostedOpacity = lastCall("route-d2", "line-opacity");
      expect(focusedOpacity[2]).toBe(1);
      expect(ghostedOpacity[2]).toBeLessThan(0.55); // strictly ghostier than the old faint-fade value
      expect(ghostedOpacity[2]).toBeGreaterThan(0);

      const focusedColor = lastCall("route-d1", "line-color");
      const ghostedColor = lastCall("route-d2", "line-color");
      // The focused day keeps its own accent colour; the non-focused day
      // shifts to a shared neutral tone rather than its accent at low opacity.
      expect(ghostedColor[2]).not.toBe(focusedColor[2]);
      expect(ghostedColor[2]).toBe("TEST-SLATE");
    });

    it("restores a day's own accent colour and full opacity once it becomes the focused day", async () => {
      // See the previous test for why these are opaque markers, not real hex.
      document.documentElement.style.setProperty("--color-danger", "TEST-DANGER");
      document.documentElement.style.setProperty("--color-success", "TEST-SUCCESS");
      document.documentElement.style.setProperty("--color-slate", "TEST-SLATE");
      // See the previous test's comment — clear so the waitFor calls below
      // wait for this render's own effects, not a leftover call.
      setPaintPropertyMock.mockClear();
      const detail = detailWithTwoDays();
      useFocusMock.mockReturnValue({ focusedDay: 0, setFocusedDay: vi.fn() });
      const { rerender } = render(
        <EditorHost>
          <MapLens detail={detail} onSelectActivity={vi.fn()} />
        </EditorHost>,
      );
      await waitFor(() => expect(setPaintPropertyMock).toHaveBeenCalled());

      useFocusMock.mockReturnValue({ focusedDay: 1, setFocusedDay: vi.fn() });
      rerender(
        <EditorHost>
          <MapLens detail={detail} onSelectActivity={vi.fn()} />
        </EditorHost>,
      );

      await waitFor(() => {
        const latestOpacity = setPaintPropertyMock.mock.calls
          .filter(([layerId, prop]) => layerId === "route-d2" && prop === "line-opacity")
          .at(-1)!;
        expect(latestOpacity[2]).toBe(1);
      });
      const latestColor = setPaintPropertyMock.mock.calls
        .filter(([layerId, prop]) => layerId === "route-d2" && prop === "line-color")
        .at(-1)!;
      expect(latestColor[2]).toBe("TEST-SUCCESS");
    });
  });

  describe("marker ghosting on focus", () => {
    it("ghosts every non-focused day's markers and keeps the focused day's markers full-strength", async () => {
      markerInstances.length = 0;
      renderMap(detailWithTwoDays(), { focusedDay: 0 });
      await waitFor(() => expect(markerInstances).toHaveLength(4));

      const [a1, a2, b1, b2] = markerInstances;

      // Day 0's stops (a1, a2) are focused — full strength.
      expect(a1!.getElement().style.opacity).toBe("1");
      expect(a2!.getElement().style.opacity).toBe("1");

      // Day 1's stops (b1, b2) are not focused — ghosted.
      expect(Number(b1!.getElement().style.opacity)).toBeLessThan(1);
      expect(Number(b1!.getElement().style.opacity)).toBeGreaterThan(0);
      expect(b1!.getElement().style.opacity).toBe(b2!.getElement().style.opacity);
    });

    it("keeps every marker full-strength when nothing is focused", async () => {
      markerInstances.length = 0;
      renderMap(detailWithTwoDays(), { focusedDay: null });
      await waitFor(() => expect(markerInstances).toHaveLength(4));

      for (const marker of markerInstances) {
        expect(marker.getElement().style.opacity).toBe("1");
      }
    });

    it("re-ghosts the previously-focused day's markers and un-ghosts the newly-focused day's when focus changes", async () => {
      markerInstances.length = 0;
      const onSelectActivity = vi.fn();
      const detail = detailWithTwoDays();
      useFocusMock.mockReturnValue({ focusedDay: 0, setFocusedDay: vi.fn() });
      const { rerender } = render(
        <EditorHost>
          <MapLens detail={detail} onSelectActivity={onSelectActivity} />
        </EditorHost>,
      );
      await waitFor(() => expect(markerInstances).toHaveLength(4));
      const [a1, , b1] = markerInstances;
      expect(a1!.getElement().style.opacity).toBe("1");
      expect(Number(b1!.getElement().style.opacity)).toBeLessThan(1);

      useFocusMock.mockReturnValue({ focusedDay: 1, setFocusedDay: vi.fn() });
      rerender(
        <EditorHost>
          <MapLens detail={detail} onSelectActivity={onSelectActivity} />
        </EditorHost>,
      );

      await waitFor(() => expect(b1!.getElement().style.opacity).toBe("1"));
      expect(Number(a1!.getElement().style.opacity)).toBeLessThan(1);
    });

    it("never plots a backlog-located activity — only the day-attached stops get markers", async () => {
      markerInstances.length = 0;
      renderMap(detailWithBacklogPin(), { focusedDay: 0 });
      await waitFor(() => expect(mapOnLoad).toHaveBeenCalled());

      // a1, a2 (day 0's stops) only — c1 (backlog-located) gets no marker at
      // all now that the map doesn't plot anything off a day.
      expect(markerInstances).toHaveLength(2);
    });
  });
});
