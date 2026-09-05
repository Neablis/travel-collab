import type { TripDetail } from "@tc/contracts";
import { locationFactory, pageFixture, tripDetailFactory } from "@tc/factories";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { phoneAskContext, type PhoneAskSurface } from "./phoneAskContext";
import { suggestedQuestions } from "./suggestedQuestions";
import { witness } from "@/test-support/witness";

const PLAN: PhoneAskSurface = { tab: "plan" };
const MAP: PhoneAskSurface = { tab: "map" };
const NOTEBOOK_INDEX: PhoneAskSurface = { tab: "notebook", page: null };

function tripWith(transient: {
  dayCount?: number;
  activitiesPerDay?: number;
  located?: boolean;
  startDate?: string | null;
}): TripDetail {
  return tripDetailFactory.build({}, { transient });
}

// The day rail derives a day's city from its LAST located stop (`cityFor`), so
// that is the one this has to move.
function inCity(trip: TripDetail, dayIndex: number, city: string): TripDetail {
  const ids = trip.days[dayIndex]!.activityIds;
  const last = ids[ids.length - 1]!;
  return {
    ...trip,
    activities: {
      ...trip.activities,
      [last]: { ...trip.activities[last]!, location: locationFactory.build({ city }) },
    },
  };
}

function pageSurface(overrides: { title?: string; unsetUpWidgets?: number | null } = {}): PhoneAskSurface {
  const page = pageFixture({ title: overrides.title ?? "Kyoto — getting around" });
  return {
    tab: "notebook",
    page: { pageId: page.id, title: page.title, unsetUpWidgets: overrides.unsetUpWidgets ?? null },
  };
}

describe("phoneAskContext", () => {
  describe("Plan and Map", () => {
    // SPEC §23's own example line. It has to be the day rail's wording, not a
    // second format that happens to look similar — the chip is on screen behind
    // the sheet saying the same thing.
    it("names the focused day exactly as the day rail's chip does", () => {
      const trip = inCity(tripWith({ dayCount: 1, activitiesPerDay: 2, startDate: "2026-06-26" }), 0, "Kyoto");
      const ctx = phoneAskContext(trip, 0, PLAN);
      expect(ctx.contextLine).toBe("Asking about Fri 26 · Kyoto");
      expect(ctx.scope).toEqual({ kind: "day", dayIndex: 0 });
      expect(ctx.emptyHint).toContain("It reads the day you have open");
    });

    // `cityFor` returns null for a day whose stops name neither a city nor an
    // area, and says why. "Fri 26 · " is a separator with nothing after it.
    it("drops the separator when the day's stops name no city", () => {
      const trip = tripWith({ dayCount: 1, activitiesPerDay: 2, located: false, startDate: "2026-06-26" });
      expect(phoneAskContext(trip, 0, PLAN).contextLine).toBe("Asking about Fri 26");
    });

    it("falls back to the trip's own name, and trip scope, when no day is focused", () => {
      const trip = tripWith({ dayCount: 3, activitiesPerDay: 1 });
      const ctx = phoneAskContext(trip, null, PLAN);
      expect(ctx.contextLine).toBe(`Asking about ${trip.name}`);
      expect(ctx.scope).toEqual({ kind: "trip" });
    });

    // FocusProvider's index survives the day it pointed at being removed. The
    // wider reading is the safe one, exactly as `parseAskScope` chooses — a
    // `day` scope naming a day that is gone is the one thing this must not send.
    it("reads a stale focused index as no focus at all", () => {
      const trip = tripWith({ dayCount: 2, activitiesPerDay: 1 });
      expect(phoneAskContext(trip, 7, PLAN).scope).toEqual({ kind: "trip" });
      expect(phoneAskContext(trip, -1, PLAN).scope).toEqual({ kind: "trip" });
    });

    // Map is a lens over the same days, so the pill on it is scoped identically.
    // Two tabs deriving two different scopes for one day is the drift §23's
    // "same pill, same label, same position" is guarding against.
    it("derives the same context on Map as on Plan", () => {
      const trip = inCity(tripWith({ dayCount: 2, activitiesPerDay: 2, startDate: "2026-06-26" }), 1, "Kyoto");
      expect(phoneAskContext(trip, 1, MAP)).toEqual(phoneAskContext(trip, 1, PLAN));
    });

    // The load-bearing half of judgement call 3: no second derivation for a
    // surface that already has one. If this ever stops holding, the phone has
    // grown its own quick-ask list — the `PREVIEW_QUICK_ASKS` shape M16 Wave 2
    // deleted, in phone clothing.
    it("asks `suggestedQuestions` rather than carrying its own list", () => {
      const trip = tripWith({ dayCount: 3, activitiesPerDay: 2 });
      expect(phoneAskContext(trip, 1, PLAN).quickAsks).toEqual(suggestedQuestions(trip, 1));
      expect(phoneAskContext(trip, null, PLAN).quickAsks).toEqual(suggestedQuestions(trip, null));
    });
  });

  describe("the Notebook index", () => {
    it("is trip-scoped and says so", () => {
      const trip = tripWith({ dayCount: 3, activitiesPerDay: 1 });
      const ctx = phoneAskContext(trip, 1, NOTEBOOK_INDEX);
      expect(ctx.contextLine).toBe("Asking about this trip’s Notebook");
      expect(ctx.scope).toEqual({ kind: "trip" });
      expect(ctx.emptyHint).toBe("It reads the page you have open, its widgets and what they are pointed at.");
    });

    // A focused day does NOT leak through the Notebook tab. The scope comes
    // from the surface you opened the sheet on, and the Notebook index is not
    // showing a day.
    it("ignores the focused day", () => {
      const trip = tripWith({ dayCount: 3, activitiesPerDay: 1 });
      expect(phoneAskContext(trip, 0, NOTEBOOK_INDEX).scope).toEqual({ kind: "trip" });
    });

    // Both of §23's Notebook asks name "this page" and the index has none.
    // A chip pointing at nothing gets an assistant refusal, which reads as the
    // assistant being broken rather than the chip being wrong.
    it("offers no quick asks, because both of them name a page it has not got", () => {
      const trip = tripWith({ dayCount: 2, activitiesPerDay: 1 });
      expect(phoneAskContext(trip, null, NOTEBOOK_INDEX).quickAsks).toEqual([]);
    });
  });

  describe("an open page", () => {
    it("scopes to the page and quotes its title", () => {
      const trip = tripWith({ dayCount: 2, activitiesPerDay: 1 });
      const surface = pageSurface();
      const ctx = phoneAskContext(trip, 0, surface);
      expect(ctx.contextLine).toBe("Asking about “Kyoto — getting around”");
      expect(ctx.scope).toEqual({ kind: "page", pageId: pageFixture().id });
      expect(ctx.quickAsks).toEqual(["Summarise this page"]);
    });

    it("offers what is not set up when the page has widgets waiting", () => {
      const trip = tripWith({ dayCount: 1, activitiesPerDay: 1 });
      expect(phoneAskContext(trip, null, pageSurface({ unsetUpWidgets: 2 })).quickAsks).toEqual([
        "What is not set up?",
        "Summarise this page",
      ]);
    });

    // The rule this module inherits from `suggestedQuestions`: never suggest a
    // question whose honest answer is "there isn't one".
    it("withholds it on a page where every widget is bound", () => {
      const trip = tripWith({ dayCount: 1, activitiesPerDay: 1 });
      expect(phoneAskContext(trip, null, pageSurface({ unsetUpWidgets: 0 })).quickAsks).toEqual([
        "Summarise this page",
      ]);
    });

    // Unknown is not zero, and it is not "probably some" either. Nothing
    // computes this count yet, so today every real page takes this branch.
    it("withholds it when the caller cannot tell how many are unbound", () => {
      const trip = tripWith({ dayCount: 1, activitiesPerDay: 1 });
      expect(phoneAskContext(trip, null, pageSurface({ unsetUpWidgets: null })).quickAsks).toEqual([
        "Summarise this page",
      ]);
    });
  });

  // "The sheet never widens past its surface, and never offers an ask whose
  // precondition is false" is a claim about ALL surfaces and all trips, so it
  // is measured over them rather than over the shapes above. The floor is
  // measured, not guessed: this property has no guard clause, so it ticks once
  // per run — 300 runs, floor 150 (half), per witness.ts's rule.
  it("never widens scope past the surface, and never offers an ask whose precondition is false", () => {
    const w = witness("phoneAskContext scope");
    const surfaces: fc.Arbitrary<PhoneAskSurface> = fc.oneof(
      fc.constant(PLAN),
      fc.constant(MAP),
      fc.constant(NOTEBOOK_INDEX),
      fc
        .record({
          title: fc.string({ minLength: 1 }),
          unsetUpWidgets: fc.option(fc.integer({ min: 0, max: 4 }), { nil: null }),
        })
        .map((p) => pageSurface(p)),
    );

    fc.assert(
      fc.property(
        fc.record({
          dayCount: fc.integer({ min: 0, max: 6 }),
          activitiesPerDay: fc.integer({ min: 0, max: 3 }),
          located: fc.boolean(),
        }),
        fc.option(fc.integer({ min: -2, max: 9 }), { nil: null }),
        surfaces,
        (transient, focusedDay, surface) => {
          const trip = tripDetailFactory.build({}, { transient });
          const ctx = phoneAskContext(trip, focusedDay, surface);
          const page = surface.tab === "notebook" ? surface.page : null;

          // A `page` scope only where a page is open; a `day` scope only on a
          // day that exists, and only the one the user is looking at.
          if (ctx.scope.kind === "page") {
            expect(page?.pageId).toBe(ctx.scope.pageId);
          } else if (ctx.scope.kind === "day") {
            expect(surface.tab === "plan" || surface.tab === "map").toBe(true);
            expect(ctx.scope.dayIndex).toBe(focusedDay);
            expect(trip.days[ctx.scope.dayIndex]).toBeDefined();
          }

          // Scope is stated, never inferred by the user (§23) — so the line is
          // always there and always says something after "Asking about".
          expect(ctx.contextLine.startsWith("Asking about ")).toBe(true);
          expect(ctx.contextLine.length).toBeGreaterThan("Asking about ".length);

          // The hint is the design's, keyed off the TAB — the Notebook index
          // and an open page share one. Pinned to the exact sentence rather
          // than to "non-empty" because it is copy the rail now prints
          // verbatim in place of its own trip-wide default: a hint that is
          // merely present, but describes the wrong surface, is the defect.
          expect(ctx.emptyHint).toBe(
            surface.tab === "notebook"
              ? "It reads the page you have open, its widgets and what they are pointed at."
              : "It reads the day you have open — the stops, their times, what is booked and what is not. " +
                  "Ask it to move something and you get a proposal to keep or discard.",
          );

          expect(ctx.quickAsks.every((a) => a.trim().length > 0)).toBe(true);
          expect(new Set(ctx.quickAsks).size).toBe(ctx.quickAsks.length);
          // The two conditional asks, each gated on the condition it asserts.
          if (ctx.quickAsks.includes("What is not set up?")) {
            expect(page?.unsetUpWidgets ?? 0).toBeGreaterThan(0);
          }
          if (ctx.quickAsks.includes("Summarise this page")) {
            expect(page).not.toBeNull();
          }
          w.tick();
        },
      ),
      { numRuns: 300 },
    );
    w.atLeast(150);
  });
});
