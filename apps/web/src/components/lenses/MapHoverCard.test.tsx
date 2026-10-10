import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ActivityKind } from "@tc/contracts";
import { PreferencesProvider } from "@/components/account/PreferencesProvider";
import {
  HOVER_CARD_BOTTOM_INSET_PX,
  HOVER_CARD_MIN_TOP_PX,
  MapHoverCard,
  hoverCardTop,
  hoverNote,
} from "./MapHoverCard";
import type { MapDay, MapStop } from "./mapRailData";

afterEach(cleanup);

const stop = (title: string): MapStop => ({
  activityId: title,
  title,
  lat: 35,
  lng: 135,
  kind: "planned" as ActivityKind,
  precision: undefined,
});

const day = (over: Partial<MapDay> = {}): MapDay => ({
  index: 0, dayId: "d1", label: "Day 1", date: "2026-09-05", city: "Kyoto",
  accent: "warning", stops: [stop("A"), stop("B")], unlocatedCount: 0, totalKm: 4.2,
  bars: [{ grow: 1, color: "warning" }], isEmpty: false, flagText: null,
  highlight: { kind: "bookends", first: "A", last: "B" }, legs: [], ...over,
});

// The clamp is the part worth asserting here: jsdom has no layout, so this
// pins the geometry rule without pretending to measure anything.
describe("hoverCardTop", () => {
  it("is top-aligned to the row when the row is comfortably inside", () => {
    expect(hoverCardTop(240, 800)).toBe(240);
  });

  it("never rides above the top inset", () => {
    expect(hoverCardTop(-40, 800)).toBe(HOVER_CARD_MIN_TOP_PX);
    expect(hoverCardTop(0, 800)).toBe(HOVER_CARD_MIN_TOP_PX);
  });

  it("never hangs off the bottom", () => {
    expect(hoverCardTop(10_000, 800)).toBe(800 - HOVER_CARD_BOTTOM_INSET_PX);
  });

  // A map wrap shorter than the bottom inset would otherwise produce a clamp
  // whose lower bound sits ABOVE its upper bound, and `Math.min(Math.max(…))`
  // would then resolve to a negative top — the card off the top of the map.
  it("degrades to the top inset when the wrap is shorter than the inset", () => {
    expect(hoverCardTop(50, 100)).toBe(HOVER_CARD_MIN_TOP_PX);
  });
});

// Mitchell, desktop Map: "Is there something better we can put in the hover
// information [than the longest hop]? Show something truly unique about that
// day." The note now says what sets the day apart (`dayHighlights`, whose
// rules mapRailData.test.ts pins); this is only its wording.
describe("hoverNote", () => {
  it("says the day is empty before anything else", () => {
    expect(hoverNote(day({ isEmpty: true, stops: [], highlight: null }), "12h")).toBe("No stops yet");
  });

  it("names the places only this day goes to, and how many more", () => {
    expect(hoverNote(day({ highlight: { kind: "only-here", places: ["Fushimi"] } }), "12h")).toBe("Only day in Fushimi");
    expect(hoverNote(day({ highlight: { kind: "only-here", places: ["Gion", "Kita"] } }), "12h")).toBe(
      "Only day in Gion and Kita",
    );
    expect(hoverNote(day({ highlight: { kind: "only-here", places: ["Gion", "Kita", "Uji", "Arashiyama"] } }), "12h")).toBe(
      "Only day in Gion, Kita and 2 more",
    );
  });

  it("names a record the day holds, in the reader's clock", () => {
    expect(hoverNote(day({ highlight: { kind: "most-stops", stops: 7 } }), "12h")).toBe("Most stops of any day (7)");
    expect(hoverNote(day({ highlight: { kind: "earliest", time: "06:30" } }), "12h")).toBe("Earliest start of the trip, 6:30 am");
    expect(hoverNote(day({ highlight: { kind: "latest", time: "22:30" } }), "24h")).toBe("Latest finish of the trip, 22:30");
  });

  it("names where the day starts and ends, or its one stop", () => {
    expect(hoverNote(day({ highlight: { kind: "bookends", first: "Nezu Museum", last: "Torishiki" } }), "12h")).toBe(
      "Starts at Nezu Museum, ends at Torishiki",
    );
    expect(hoverNote(day({ highlight: { kind: "single", title: "Onsen" } }), "12h")).toBe("Just one stop: Onsen");
  });
});

describe("MapHoverCard", () => {
  it("names the day AND the city, where the focus card shows one or the other", () => {
    render(
      <PreferencesProvider>
        <MapHoverCard day={day()} top={120} />
      </PreferencesProvider>,
    );
    expect(screen.getByText(/Day 1 · Kyoto/)).toBeTruthy();
  });

  it("says only the day and its note when trimmed, for the focused day", () => {
    render(
      <PreferencesProvider>
        <MapHoverCard day={day()} top={120} trimmed />
      </PreferencesProvider>,
    );
    const card = screen.getByTestId("map-hover-card");
    expect(card.textContent).toBe("Day 1Starts at A, ends at B");
  });

  it("lists the day's legs, and leaves them to the focus card when trimmed", () => {
    const legs = ["Train · Odawara → Kyoto"];
    const { unmount } = render(
      <PreferencesProvider>
        <MapHoverCard day={day({ legs })} top={120} />
      </PreferencesProvider>,
    );
    expect(screen.getByText("Train · Odawara → Kyoto")).toBeTruthy();
    unmount();
    render(
      <PreferencesProvider>
        <MapHoverCard day={day({ legs })} top={120} trimmed />
      </PreferencesProvider>,
    );
    expect(screen.queryByText("Train · Odawara → Kyoto")).toBeNull();
  });

  // **It must never eat a click.** The card overlaps the map and, low in the
  // rail, the rail itself; without this, hovering toward it from a row would
  // fire that row's `mouseleave` and tear the card down under the cursor.
  it("is inert: no pointer events, and out of the accessibility tree", () => {
    render(
      <PreferencesProvider>
        <MapHoverCard day={day()} top={120} />
      </PreferencesProvider>,
    );
    const card = screen.getByTestId("map-hover-card");
    expect(card.style.pointerEvents).toBe("none");
    expect(card.getAttribute("aria-hidden")).toBe("true");
  });
});
