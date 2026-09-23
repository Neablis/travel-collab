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
  longest: { km: 3.1, from: "A", to: "B" }, ...over,
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

// Exactly three notes, and the ORDER matters: an empty day also has no longest
// leg, so checking `longest` first would tell a reader with no stops at all
// that they have "a single anchor".
describe("hoverNote", () => {
  it("says the day is empty before anything else", () => {
    expect(hoverNote(day({ isEmpty: true, stops: [], longest: null }), "km")).toBe("No stops yet");
  });

  it("names a single anchor when there is nothing to travel between", () => {
    expect(hoverNote(day({ stops: [stop("A")], longest: null }), "km")).toBe(
      "A single anchor. Nothing to travel between.",
    );
  });

  it("names the longest hop and both of its ends", () => {
    expect(hoverNote(day(), "km")).toMatch(/Longest hop .* — A to B/);
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
    expect(card.textContent).toMatch(/^Day 1Longest hop/);
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
