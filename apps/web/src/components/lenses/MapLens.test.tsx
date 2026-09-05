import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityKind, ActivityTag, TripDetail } from "@tc/contracts";
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
const { openCreateCalls, wrapped } = vi.hoisted(() => ({
  openCreateCalls: [] as unknown[],
  wrapped: new WeakMap<object, unknown>(),
}));

// The real EditorHost stays mounted — only `useEditor` is wrapped, so the
// double-click test can assert WHAT the handler creates rather than merely
// that it did not throw. Passthrough: every other test in this file keeps the
// real editor behaviour.
vi.mock("@/components/trip/context/EditorHost", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/trip/context/EditorHost")>();
  return {
    ...actual,
    useEditor: () => {
      const real = actual.useEditor();
      // Cached on the real context value, so the wrapper keeps ONE identity for
      // as long as the provider does. Returning a fresh object (or a fresh
      // `openCreate`) per render changes the dep of MapLens's registration
      // effect every time, which re-runs it and double-adds every route layer —
      // a test-only mock silently changing the behaviour under test.
      const cached = wrapped.get(real) as ReturnType<typeof actual.useEditor> | undefined;
      if (cached !== undefined) return cached;
      const value = {
        ...real,
        openCreate: (input: Parameters<typeof real.openCreate>[0]) => {
          openCreateCalls.push(input);
          return real.openCreate(input);
        },
      };
      wrapped.set(real, value);
      return value;
    },
  };
});

const { addLayerMock, addSourceMock, fitBoundsMock, mapConstructorMock, mapOnLoad, mapHandlers, setPaintPropertyMock, markerInstances } = vi.hoisted(
  () => ({
    addLayerMock: vi.fn(),
    addSourceMock: vi.fn(),
    fitBoundsMock: vi.fn(),
    mapConstructorMock: vi.fn(),
    mapOnLoad: vi.fn(),
    // Every map event MapLens subscribes to, by name. The viewer gate is the
    // *absence* of a "dblclick" subscription (MapLens registers it only for an
    // editor), which is only observable if the stub records what it was asked
    // for rather than swallowing everything but "load".
    mapHandlers: new globalThis.Map<string, (e: unknown) => void>(),
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
      mapHandlers.set(event, cb as (e: unknown) => void);
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
      this.#layerIds.add((args[0] as { id: string }).id);
    }
    setPaintProperty(...args: unknown[]) {
      setPaintPropertyMock(...args);
    }
    // Real MapLibre returns the layer for an id it holds and `undefined`
    // otherwise; this used to return `undefined` unconditionally, which was
    // harmless only while nothing called it. MapLens now asks before painting
    // a route layer — a day can have travel legs, ordinary legs or both, so
    // one of its two layers may never have been added — and against the old
    // stub every one of those guards took the "not there" branch and no route
    // was ever painted. Tracking what addLayer() was given is what makes the
    // guard testable at all.
    getLayer(id: string) {
      return this.#layerIds.has(id) ? { id } : undefined;
    }
    #layerIds = new Set<string>();
    resize() {}
    fitBounds(...args: unknown[]) {
      fitBoundsMock(...args);
    }
    remove() {}
  }
  return { Map, Marker, LngLatBounds };
});

const useFocusMock = vi.fn();

// The whole FocusProvider contract, in one place. A mock that returns only the
// day half leaves `focusedTag` as `undefined` rather than `null`, which is a
// different value from the one the real provider ever produces — and every
// stop then reads as "does not carry the focused tag", so every marker ghosts
// and three ghosting tests fail for a reason that has nothing to do with what
// they assert. Spread this, override the one field a test is about.
function focusDefaults(): {
  focusedDay: number | null;
  setFocusedDay: (i: number | null) => void;
  focusedTag: ActivityTag | null;
  toggleFocusedTag: (tag: ActivityTag) => void;
  clearFocusedTag: () => void;
} {
  return {
    focusedDay: null,
    setFocusedDay: vi.fn(),
    focusedTag: null,
    toggleFocusedTag: vi.fn(),
    clearFocusedTag: vi.fn(),
  };
}
// Partial, not a bare factory: a `vi.mock` factory replaces the WHOLE module,
// and this one also exports the day-sync contract's hooks (see FocusProvider's
// header), which MapLens and MapDayStrip both take. Replacing only `useFocus`
// keeps the rest real — and they are inert here anyway, because jsdom has no
// layout for a scroll spy to measure and no `scrollIntoView` for a jump to
// call. The real `useDaySync` needs a provider, so it is stubbed: these tests
// drive focus through `useFocusMock` instead of mounting one.
vi.mock("@/components/trip/context/FocusProvider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/trip/context/FocusProvider")>()),
  useFocus: () => useFocusMock(),
  useDaySync: () => ({
    shouldFollow: true,
    isOwnScroll: () => false,
    reportScrolled: vi.fn(),
    jumpTo: () => false,
  }),
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
function locatedActivity(id: string, lat: number, lng: number, city = id, kind: ActivityKind = "planned") {
  return {
    activityId: id,
    title: id,
    timeWindow: null,
    location: { name: id, city, lat, lng },
    notes: null,
    anchors: [],
    kind,
    tags: [],
    cost: null,
  };
}

// One day whose middle stop is a train: the first and last legs both touch it,
// so both are travel, and a fourth stop after it gives the day one ordinary
// leg as well. Without that fourth stop the day would be entirely travel and
// the "rest is still solid" half of the assertion would pass vacuously.
function detailWithTransitStop(): TripDetail {
  return tripDetailFixture({
    days: [{ dayId: "d1", activityIds: ["a1", "t1", "a2", "a3"], date: "2027-06-01", costSubtotal: 0 }],
    activities: {
      a1: locatedActivity("a1", 41.89, 12.49, "a1"),
      t1: locatedActivity("t1", 42.5, 12.6, "a1", "transit"),
      a2: locatedActivity("a2", 43.0, 12.7, "a1"),
      a3: locatedActivity("a3", 43.1, 12.8, "a1"),
    },
  });
}

// Both stops on a day share that day's city, which is what a day normally
// looks like and what the accent tests here actually mean to set up.
//
// They used to fall through to `locatedActivity`'s `city = id` default, giving
// day 2 the two cities "b1" and "b2" — so the day's accent depended on WHICH of
// its stops `cityFor` happened to read. That was invisible until `cityFor`
// moved from the day's first city-bearing stop to its last (M18, Mitchell's
// day-label rule), which flipped day 2 from "b1" to "b2" and with it the accent
// this file asserts. Naming the city once per day makes these tests independent
// of that choice rather than pinned to one side of it.
function detailWithTwoDays(): TripDetail {
  return tripDetailFixture({
    days: [
      { dayId: "d1", activityIds: ["a1", "a2"], date: "2027-06-01", costSubtotal: 0 },
      { dayId: "d2", activityIds: ["b1", "b2"], date: "2027-06-02", costSubtotal: 0 },
    ],
    activities: {
      // "a1"/"b1" rather than real city names on purpose: `dayAccents` picks a
      // family from the city STRING, and this file stubs only --color-danger,
      // --color-success and --color-slate. Renaming the cities silently moves
      // day 2 onto an unstubbed family and the assertion reads "". Keeping the
      // strings the old first-stop rule produced holds the accents these tests
      // were written against; the change here is that both stops on a day now
      // agree, so the rule no longer decides the colour.
      a1: locatedActivity("a1", 41.89, 12.49, "a1"),
      a2: locatedActivity("a2", 41.9, 12.48, "a1"),
      b1: locatedActivity("b1", 43.15, -77.6, "b1"),
      b2: locatedActivity("b2", 43.16, -77.62, "b1"),
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

function renderMap(
  detail: TripDetail,
  overrides: Partial<ReturnType<typeof focusDefaults>> = {},
  readOnly = false,
) {
  useFocusMock.mockReturnValue({ ...focusDefaults(), ...overrides });
  return render(
    <EditorHost>
      <MapLens detail={detail} onSelectActivity={vi.fn()} readOnly={readOnly} />
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
    useFocusMock.mockReturnValue(focusDefaults());
    const { container } = render(
      <EditorHost>
        <MapLens detail={detailFixture()} onSelectActivity={onSelectActivity} />
      </EditorHost>,
    );

    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
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

  // Mitchell, 2026-08-30 design pass: "Travel activity kinds should be dotted
  // line, not solid." The dash cannot be a data-driven expression in
  // MapLibre, so it is a second layer per day rather than a property on the
  // feature — this asserts the split actually happens and that only the
  // travel half is dashed.
  it("draws travel legs as a separate dashed layer, leaving the rest solid", async () => {
    renderMap(detailWithTransitStop());
    await waitFor(() => expect(addLayerMock).toHaveBeenCalled());

    const byId = new Map(
      addLayerMock.mock.calls
        .map(([layer]) => layer as { id: string; paint: Record<string, unknown> })
        .filter((layer) => layer.id.startsWith("route-"))
        .map((layer) => [layer.id, layer]),
    );

    expect(byId.get("route-travel-d1")?.paint["line-dasharray"]).toBeDefined();
    expect(byId.get("route-rest-d1")?.paint["line-dasharray"]).toBeUndefined();
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
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
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

      const focusedOpacity = lastCall("route-rest-d1", "line-opacity");
      const ghostedOpacity = lastCall("route-rest-d2", "line-opacity");
      expect(focusedOpacity[2]).toBe(1);
      expect(ghostedOpacity[2]).toBeLessThan(0.55); // strictly ghostier than the old faint-fade value
      expect(ghostedOpacity[2]).toBeGreaterThan(0);

      const focusedColor = lastCall("route-rest-d1", "line-color");
      const ghostedColor = lastCall("route-rest-d2", "line-color");
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
      useFocusMock.mockReturnValue({ ...focusDefaults(), focusedDay: 0 });
      const { rerender } = render(
        <EditorHost>
          <MapLens detail={detail} onSelectActivity={vi.fn()} />
        </EditorHost>,
      );
      await waitFor(() => expect(setPaintPropertyMock).toHaveBeenCalled());

      useFocusMock.mockReturnValue({ ...focusDefaults(), focusedDay: 1 });
      rerender(
        <EditorHost>
          <MapLens detail={detail} onSelectActivity={vi.fn()} />
        </EditorHost>,
      );

      await waitFor(() => {
        const latestOpacity = setPaintPropertyMock.mock.calls
          .filter(([layerId, prop]) => layerId === "route-rest-d2" && prop === "line-opacity")
          .at(-1)!;
        expect(latestOpacity[2]).toBe(1);
      });
      const latestColor = setPaintPropertyMock.mock.calls
        .filter(([layerId, prop]) => layerId === "route-rest-d2" && prop === "line-color")
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
      useFocusMock.mockReturnValue({ ...focusDefaults(), focusedDay: 0 });
      const { rerender } = render(
        <EditorHost>
          <MapLens detail={detail} onSelectActivity={onSelectActivity} />
        </EditorHost>,
      );
      await waitFor(() => expect(markerInstances).toHaveLength(4));
      const [a1, , b1] = markerInstances;
      expect(a1!.getElement().style.opacity).toBe("1");
      expect(Number(b1!.getElement().style.opacity)).toBeLessThan(1);

      useFocusMock.mockReturnValue({ ...focusDefaults(), focusedDay: 1 });
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

// CodeRabbit, PR #78: M11 link 3 viewer-gated the Board lens; the Map lens was
// left out, and double-click-to-create is its one write affordance. Everything
// else here is read — routes, pins, rail, legend, and the marker click that
// opens a stop (the sheet presents read-only for a viewer, ActivityEditorSheet)
// — so this is the only thing a viewer loses. The server refuses AddActivity
// from a viewer independently (accessPolicy.ts); this is defence in depth.
describe("MapLens — a viewer's map", () => {
  beforeEach(() => {
    mapHandlers.clear();
    markerInstances.length = 0;
    addLayerMock.mockClear();
    openCreateCalls.length = 0;
  });

  it("registers no double-click-to-create handler", async () => {
    renderMap(detailWithTwoDays(), {}, true);
    await waitFor(() => expect(mapOnLoad).toHaveBeenCalled());
    expect(mapHandlers.has("dblclick")).toBe(false);
  });

  it("still draws every route and pin", async () => {
    renderMap(detailWithTwoDays(), {}, true);
    await waitFor(() => expect(mapOnLoad).toHaveBeenCalled());
    expect(addLayerMock).toHaveBeenCalledTimes(2);
    expect(markerInstances).toHaveLength(4);
    expect(screen.getByTestId("map-lens")).toBeTruthy();
  });

  it("registers it for an editor, and it opens the editor prefilled at the clicked point", async () => {
    renderMap(detailWithTwoDays());
    await waitFor(() => expect(mapOnLoad).toHaveBeenCalled());
    expect(mapHandlers.has("dblclick")).toBe(true);

    // The handler itself, driven the way maplibre would drive it. Asserting the
    // PAYLOAD, not merely that it did not throw: a handler that silently did
    // nothing would satisfy "does not throw" while creating no stop, and the
    // whole claim here is that registration means the click reaches openCreate
    // carrying the point that was clicked.
    mapHandlers.get("dblclick")!({ lngLat: { lng: 12.4922, lat: 41.8902 } });

    expect(openCreateCalls).toHaveLength(1);
    expect(openCreateCalls[0]).toMatchObject({
      location: { lat: 41.8902, lng: 12.4922 },
    });
  });
});

// M18b — the Map's half of SPEC §11. A pin can be dimmed on two independent
// counts (its day is not the focused one; it does not carry the focused tag),
// which is a case none of the other lenses has.
describe("MapLens tag focus", () => {
  function detailWithTags(): TripDetail {
    const detail = detailWithTwoDays();
    detail.activities.a1!.tags = ["meal"];
    detail.activities.b1!.tags = ["meal"];
    // a2 and b2 stay untagged.
    return detail;
  }

  // The baseline this set is read against: nothing focused at all. Named for
  // what it passes rather than for tag focus — it used to claim "when a tag is
  // focused" while passing `focusedTag: null`, so it asserted the no-focus case
  // under a tag-focus name (CodeRabbit, PR #91). The focused case is the next
  // test.
  it("keeps every pin full-strength when neither a day nor a tag is focused", async () => {
    markerInstances.length = 0;
    renderMap(detailWithTags(), { focusedDay: null, focusedTag: null });
    await waitFor(() => expect(markerInstances).toHaveLength(4));
    for (const marker of markerInstances) expect(marker.getElement().style.opacity).toBe("1");
  });

  it("dims only the pins that do not carry the focused tag", async () => {
    markerInstances.length = 0;
    renderMap(detailWithTags(), { focusedDay: null, focusedTag: "meal" });
    await waitFor(() => expect(markerInstances).toHaveLength(4));
    const [a1, a2, b1, b2] = markerInstances;

    // Tagged, on either day — a tag focus is not a day focus.
    expect(a1!.getElement().style.opacity).toBe("1");
    expect(b1!.getElement().style.opacity).toBe("1");
    expect(Number(a2!.getElement().style.opacity)).toBeCloseTo(0.32);
    expect(Number(b2!.getElement().style.opacity)).toBeCloseTo(0.32);
  });

  // The two dims compose by taking the fainter, not by multiplying: 0.35 ×
  // 0.32 is 0.11, which is invisible, and "dim, never hide" is the rule.
  it("takes the fainter of the day dim and the tag dim, never their product", async () => {
    markerInstances.length = 0;
    renderMap(detailWithTags(), { focusedDay: 0, focusedTag: "meal" });
    await waitFor(() => expect(markerInstances).toHaveLength(4));
    const [a1, a2, b1, b2] = markerInstances;

    // Focused day, focused tag.
    expect(a1!.getElement().style.opacity).toBe("1");
    // Focused day, wrong tag — the tag dim (0.32) is the fainter.
    expect(Number(a2!.getElement().style.opacity)).toBeCloseTo(0.32);
    // Other day, right tag — only the day dim (0.35) applies.
    expect(Number(b1!.getElement().style.opacity)).toBeCloseTo(0.35);
    // Other day, wrong tag — both apply, and 0.32 wins over 0.35.
    expect(Number(b2!.getElement().style.opacity)).toBeCloseTo(0.32);
    expect(Number(b2!.getElement().style.opacity)).toBeGreaterThan(0.35 * 0.32);
  });

  it("un-dims when the tag focus clears", async () => {
    markerInstances.length = 0;
    const detail = detailWithTags();
    // One stable `onSelectActivity` across both renders: it is a dep of the
    // map-creation effect, so a fresh `vi.fn()` on the rerender tears the map
    // down and rebuilds it, and the marker captured below is then a detached
    // one from the previous instance.
    const onSelectActivity = vi.fn();
    useFocusMock.mockReturnValue({ ...focusDefaults(), focusedTag: "meal" });
    const { rerender } = render(
      <EditorHost>
        <MapLens detail={detail} onSelectActivity={onSelectActivity} />
      </EditorHost>,
    );
    await waitFor(() => expect(markerInstances).toHaveLength(4));
    const [, a2] = markerInstances;
    expect(Number(a2!.getElement().style.opacity)).toBeCloseTo(0.32);

    useFocusMock.mockReturnValue(focusDefaults());
    rerender(
      <EditorHost>
        <MapLens detail={detail} onSelectActivity={onSelectActivity} />
      </EditorHost>,
    );
    await waitFor(() => expect(a2!.getElement().style.opacity).toBe("1"));
  });

  // The regression test for the bug this milestone introduced and CodeRabbit
  // caught: `focusedTag` went into the deps of the effect that ALSO calls
  // `fitBounds`, so focusing a tag re-fitted the camera to the focused day and
  // threw away a viewport the user had panned by hand. Styling and camera are
  // two effects now, and only the day drives the camera.
  it("does not move the camera when only the focused TAG changes", async () => {
    markerInstances.length = 0;
    // `fitBoundsMock` is file-scoped and nothing resets it, so on entry it
    // already carries every earlier test's calls — nine of them. Waiting on a
    // bare `toHaveBeenCalled()` therefore resolves instantly against somebody
    // else's call, and the mount's own fit then lands AFTER the clear and
    // reads as a call this test caused. Clear first, then count.
    fitBoundsMock.mockClear();
    const detail = detailWithTags();
    const onSelectActivity = vi.fn();
    useFocusMock.mockReturnValue({ ...focusDefaults(), focusedDay: 0 });
    const { rerender } = render(
      <EditorHost>
        <MapLens detail={detail} onSelectActivity={onSelectActivity} />
      </EditorHost>,
    );
    // The day focus legitimately fits the camera once, on mount.
    await waitFor(() => expect(fitBoundsMock).toHaveBeenCalledTimes(1));
    fitBoundsMock.mockClear();

    // Same day, new tag: the pins restyle and the viewport holds.
    useFocusMock.mockReturnValue({ ...focusDefaults(), focusedDay: 0, focusedTag: "meal" });
    rerender(
      <EditorHost>
        <MapLens detail={detail} onSelectActivity={onSelectActivity} />
      </EditorHost>,
    );
    const [, a2] = markerInstances;
    await waitFor(() => expect(Number(a2!.getElement().style.opacity)).toBeCloseTo(0.32));
    expect(fitBoundsMock).not.toHaveBeenCalled();

    // And the camera still follows a real day change, so the split did not
    // simply disconnect it.
    useFocusMock.mockReturnValue({ ...focusDefaults(), focusedDay: 1, focusedTag: "meal" });
    rerender(
      <EditorHost>
        <MapLens detail={detail} onSelectActivity={onSelectActivity} />
      </EditorHost>,
    );
    await waitFor(() => expect(fitBoundsMock).toHaveBeenCalled());
  });

  // Dim, never hide: a tag focus removes no marker from the map.
  it("plots every stop regardless of the focused tag", async () => {
    markerInstances.length = 0;
    renderMap(detailWithTags(), { focusedDay: null, focusedTag: "lodging" });
    await waitFor(() => expect(markerInstances).toHaveLength(4));
    for (const marker of markerInstances) {
      expect(Number(marker.getElement().style.opacity)).toBeCloseTo(0.32);
    }
  });
});

// Mitchell, 2026-08-30 design pass: "map view pretty broken on mobile … remove
// legend on mobile, and figure out a different static location for the days,
// have less info and make that where you scroll so map jumping still works."
//
// jsdom ships no `matchMedia`, so every test above this block takes the
// desktop branch by way of `useIsPhone`'s feature detection — which is what
// keeps them meaningful as *desktop* tests rather than accidentally passing.
// These two install one.
describe("MapLens on a phone", () => {
  function setViewportMatches(matches: boolean) {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: (query: string) => ({
        matches,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }),
    });
  }

  afterEach(() => {
    Reflect.deleteProperty(window, "matchMedia");
  });

  it("swaps the rail, focus card and legend for one day strip below 768px", async () => {
    setViewportMatches(true);
    renderMap(detailWithTwoDays(), { focusedDay: 0 });

    // eslint-disable-next-line testing-library/prefer-find-by -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    await waitFor(() => expect(screen.getByTestId("map-day-strip")).toBeTruthy());
    // The rail is the thing the strip replaces; both at once is the bug.
    // eslint-disable-next-line testing-library/prefer-presence-queries -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    expect(screen.queryByRole("button", { name: /Day 1/ })).toBeTruthy();
    // eslint-disable-next-line testing-library/no-node-access -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    expect(document.querySelector("[data-rail-track]")).toBeNull();
    // The legend's copy is its own; nothing else on the lens says this.
    expect(screen.queryByText("Rest of trip")).toBeNull();
  });

  it("keeps all three on a desktop viewport", async () => {
    setViewportMatches(false);
    renderMap(detailWithTwoDays(), { focusedDay: 0 });

    // eslint-disable-next-line testing-library/no-node-access -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    await waitFor(() => expect(document.querySelector("[data-rail-track]")).toBeTruthy());
    expect(screen.queryByTestId("map-day-strip")).toBeNull();
    expect(screen.getByText("Rest of trip")).toBeTruthy();
  });

  // Without this the camera would still reserve the rail's 284px of left
  // clearance on a 411px screen — two thirds of the width given to a panel
  // that is no longer there, which would squeeze every focused day into the
  // right-hand third.
  it("moves the camera's clearance from the rail's left edge to the strip's top", async () => {
    setViewportMatches(true);
    fitBoundsMock.mockClear();
    renderMap(detailWithTwoDays(), { focusedDay: 0 });

    await waitFor(() => expect(fitBoundsMock).toHaveBeenCalled());
    const padding = fitBoundsMock.mock.calls.at(-1)![1].padding as {
      top: number;
      right: number;
      bottom: number;
      left: number;
    };
    expect(padding.left).toBeLessThan(MAP_RAIL_INSET_PX + MAP_RAIL_WIDTH_PX);
    expect(padding.top).toBeGreaterThan(padding.bottom);
  });

  // CodeRabbit, PR #98: the creation effect keyed on pins only
  // (activityId:lat:lng), so flipping a stop to `transit` without moving it
  // left the route layers untouched and the leg stayed solid. The dashed
  // layer is only correct if a kind change rebuilds them.
  it("rebuilds the route layers when a stop's kind changes but nothing moves", async () => {
    setViewportMatches(false);
    const before = detailWithTwoDays();
    // One stable callback across both renders. Handing `rerender` a fresh
    // `vi.fn()` changes `onSelectActivity`, which is itself a dependency of
    // the creation effect — the effect would then re-run for that reason and
    // the test would pass against the very bug it exists to catch. (It did,
    // the first time this was written.)
    const onSelectActivity = vi.fn();
    useFocusMock.mockReturnValue(focusDefaults());
    const { rerender } = render(
      <EditorHost>
        <MapLens detail={before} onSelectActivity={onSelectActivity} readOnly={false} />
      </EditorHost>,
    );
    await waitFor(() => expect(addLayerMock).toHaveBeenCalled());

    const travelLayers = () =>
      addLayerMock.mock.calls.filter(([layer]) => (layer as { id: string }).id.startsWith("route-travel-")).length;
    expect(travelLayers()).toBe(0);

    // Same ids, same coordinates, same order — only the kind moves.
    const after = {
      ...before,
      activities: {
        ...before.activities,
        a2: { ...before.activities.a2!, kind: "transit" as const },
      },
    };
    rerender(
      <EditorHost>
        <MapLens detail={after} onSelectActivity={onSelectActivity} readOnly={false} />
      </EditorHost>,
    );

    await waitFor(() => expect(travelLayers()).toBeGreaterThan(0));
  });

  // CodeRabbit, PR #98, on the fix above: a day's colour comes from its city
  // (chipModel -> dayAccents), so editing a stop's city repaints its routes
  // and markers without touching an id, a coordinate or a kind. Keying on
  // stops alone left those the old colour.
  it("rebuilds the route layers when a day's accent changes but no stop moves", async () => {
    setViewportMatches(false);
    document.documentElement.style.setProperty("--color-danger", "TEST-DANGER");
    document.documentElement.style.setProperty("--color-success", "TEST-SUCCESS");
    const before = detailWithTwoDays();
    const onSelectActivity = vi.fn();
    useFocusMock.mockReturnValue(focusDefaults());
    const { rerender } = render(
      <EditorHost>
        <MapLens detail={before} onSelectActivity={onSelectActivity} readOnly={false} />
      </EditorHost>,
    );
    await waitFor(() => expect(addLayerMock).toHaveBeenCalled());

    const day1Colour = () =>
      addLayerMock.mock.calls
        .map(([layer]) => layer as { id: string; paint: Record<string, unknown> })
        .filter((layer) => layer.id === "route-rest-d1")
        .at(-1)?.paint["line-color"];
    const first = day1Colour();

    // Day 1's stops keep their ids, coordinates and kinds; only the city they
    // sit in changes, which moves the day onto day 2's accent family.
    const after = {
      ...before,
      activities: {
        ...before.activities,
        a1: { ...before.activities.a1!, location: { ...before.activities.a1!.location!, city: "b1" } },
        a2: { ...before.activities.a2!, location: { ...before.activities.a2!.location!, city: "b1" } },
      },
    };
    rerender(
      <EditorHost>
        <MapLens detail={after} onSelectActivity={onSelectActivity} readOnly={false} />
      </EditorHost>,
    );

    await waitFor(() => expect(day1Colour()).not.toBe(first));
  });

  // The e2e test at 411px asserts that tapping a chip updates the strip's
  // detail line, which a broken onFocus -> fitBounds handoff would still
  // satisfy. This is the half that actually pins "map jumping still works".
  it("moves the camera when a day is tapped in the strip", async () => {
    setViewportMatches(true);
    renderMap(detailWithTwoDays(), { focusedDay: null });

    // eslint-disable-next-line testing-library/prefer-find-by -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    await waitFor(() => expect(screen.getByTestId("map-day-strip")).toBeTruthy());
    fitBoundsMock.mockClear();

    // useFocus is mocked, so the click's own setFocusedDay cannot drive a
    // rerender here — assert the strip calls it, then that the resulting
    // focusedDay is what moves the camera.
    const onFocus = useFocusMock.mock.results.at(-1)!.value.setFocusedDay as ReturnType<typeof vi.fn>;
    await userEvent.click(screen.getByRole("button", { name: /Day 2/ }));
    // `"map-strip"` names where the pick happened, which is what stops the
    // strip's own scroll spy talking the reader out of a day it cannot centre
    // (`FocusProvider`'s `jumpTo`). Asserted rather than ignored with
    // `expect.anything()`: the lens's own default focus deliberately passes NO
    // container here, and the two must not drift into each other.
    expect(onFocus).toHaveBeenCalledWith(1, "map-strip");

    renderMap(detailWithTwoDays(), { focusedDay: 1 });
    await waitFor(() => expect(fitBoundsMock).toHaveBeenCalled());
  });

  // The strip carries the detail the rail rows and the focus card used to,
  // for the focused day only — that is the "have less info" half of the ask,
  // and the reason dropping the focus card loses nothing.
  it("shows the focused day's stop count and distance in the strip", async () => {
    setViewportMatches(true);
    renderMap(detailWithTwoDays(), { focusedDay: 0 });

    // eslint-disable-next-line testing-library/prefer-find-by -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    await waitFor(() => expect(screen.getByTestId("map-day-strip")).toBeTruthy());
    expect(screen.getByTestId("map-day-strip-detail").textContent).toMatch(/2 stops/);
  });
});
