import type { Conflict, TripDetail } from "@tc/contracts";
import { tripDetailFactory } from "@tc/factories";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { witness } from "@/test-support/witness";
import { MAX_SUGGESTIONS, suggestedQuestions } from "./suggestedQuestions";

function tripWith(transient: {
  dayCount?: number;
  activitiesPerDay?: number;
  unscheduledCount?: number;
}): TripDetail {
  return tripDetailFactory.build({}, { transient });
}

function conflictOn(subjects: string[], id: string): Conflict {
  return { id, kind: "overlap", severity: "warn", subjects, description: "Two stops overlap", resolutions: [] };
}

describe("suggestedQuestions", () => {
  describe("a day is focused", () => {
    it("asks about that day, naming it in 1-based day numbers", () => {
      const trip = tripWith({ dayCount: 4, activitiesPerDay: 3 });
      const questions = suggestedQuestions(trip, 2);
      expect(questions).toContain("What's the plan for day 3?");
      expect(questions).toContain("Where's the most free time on day 3?");
      // The scope sent to /ask is 0-based; nothing the user reads ever is.
      expect(questions.some((q) => q.includes("day 2"))).toBe(false);
    });

    // The rule the whole module exists for: a suggestion whose honest answer
    // is "there isn't one" is a broken suggestion. An empty day has no plan to
    // summarise and no free time worth naming — it is all free.
    it("does not ask what the plan is on a day that has no stops", () => {
      const trip = tripWith({ dayCount: 2, activitiesPerDay: 0 });
      const questions = suggestedQuestions(trip, 1);
      expect(questions).not.toContain("What's the plan for day 2?");
      expect(questions).toEqual(["Day 2 is empty — what could I do with it?"]);
    });

    it("names the count when conflicts touch the focused day", () => {
      const trip = tripWith({ dayCount: 3, activitiesPerDay: 2 });
      const [first, second] = trip.days[1]!.activityIds;
      const withConflicts: TripDetail = {
        ...trip,
        conflicts: [conflictOn([first!, second!], "c1"), conflictOn([first!], "c2")],
      };
      expect(suggestedQuestions(withConflicts, 1)).toContain(
        "There are 2 conflicts on day 2 — how should I fix them?",
      );
    });

    // Conflicts are trip-wide data, but a day-scoped turn is instructed not to
    // wander off its day (task 3's scope instruction). Offering "what about the
    // 2 open conflicts?" while looking at a day that has none is exactly the
    // "there isn't one" answer.
    it("says nothing about conflicts that do not touch the focused day", () => {
      const trip = tripWith({ dayCount: 3, activitiesPerDay: 2 });
      const elsewhere = trip.days[2]!.activityIds[0]!;
      const withConflicts: TripDetail = { ...trip, conflicts: [conflictOn([elsewhere], "c1")] };
      expect(suggestedQuestions(withConflicts, 0).some((q) => q.includes("conflict"))).toBe(false);
    });

    it("ignores a conflict the user already dismissed", () => {
      const trip = tripWith({ dayCount: 2, activitiesPerDay: 2 });
      const subject = trip.days[0]!.activityIds[0]!;
      const withConflicts: TripDetail = {
        ...trip,
        conflicts: [conflictOn([subject], "c1")],
        dismissedConflictIds: ["c1"],
      };
      expect(suggestedQuestions(withConflicts, 0).some((q) => q.includes("conflict"))).toBe(false);
    });

    // M18's `kind` is merged and readable. "N to book" counts everything that
    // is neither `booked` nor `transit` — the same rule the calendar uses.
    it("asks what still needs booking when the day holds an unbooked stop", () => {
      const trip = tripWith({ dayCount: 2, activitiesPerDay: 2 });
      expect(suggestedQuestions(trip, 0)).toContain("What on day 1 still needs booking?");
    });

    it("says nothing about booking when every stop on the day is booked or transit", () => {
      const trip = tripWith({ dayCount: 2, activitiesPerDay: 2 });
      const [a, b] = trip.days[0]!.activityIds;
      const settled: TripDetail = {
        ...trip,
        activities: {
          ...trip.activities,
          [a!]: { ...trip.activities[a!]!, kind: "booked" },
          [b!]: { ...trip.activities[b!]!, kind: "transit" },
        },
      };
      expect(suggestedQuestions(settled, 0).some((q) => q.includes("booking"))).toBe(false);
    });

    // FocusProvider's index survives the day it pointed at being removed. The
    // wider reading is the safe one, exactly as `parseAskScope` chooses.
    it("falls back to trip-shaped questions when the focused index is out of range", () => {
      const trip = tripWith({ dayCount: 2, activitiesPerDay: 1 });
      expect(suggestedQuestions(trip, 7)).toContain("How is the trip looking?");
    });
  });

  describe("no day is focused", () => {
    it("asks trip-shaped questions", () => {
      const trip = tripWith({ dayCount: 3, activitiesPerDay: 2 });
      const questions = suggestedQuestions(trip, null);
      expect(questions).toContain("How is the trip looking?");
      expect(questions).toContain("Which day has the most free time?");
    });

    it("does not ask which day has the most free time when nothing is scheduled at all", () => {
      const trip = tripWith({ dayCount: 3, activitiesPerDay: 0 });
      expect(suggestedQuestions(trip, null)).not.toContain("Which day has the most free time?");
    });

    it("names the open-conflict count", () => {
      const trip = tripWith({ dayCount: 2, activitiesPerDay: 1 });
      const withConflicts: TripDetail = {
        ...trip,
        conflicts: [conflictOn(["x"], "c1"), conflictOn(["y"], "c2"), conflictOn(["z"], "c3")],
        dismissedConflictIds: ["c3"],
      };
      expect(suggestedQuestions(withConflicts, null)).toContain(
        "There are 2 conflicts still open — what should I do about them?",
      );
    });

    it("names the unbooked-stop count", () => {
      const trip = tripWith({ dayCount: 2, activitiesPerDay: 2 });
      expect(suggestedQuestions(trip, null)).toContain(
        "4 stops still need booking — which should I sort out first?",
      );
    });
  });

  describe("an empty trip", () => {
    // Not "what's the plan for day 1?" against a trip with no day 1.
    it("asks how to start a plan, and nothing about content it does not have", () => {
      const trip = tripWith({ dayCount: 0 });
      expect(suggestedQuestions(trip, null)).toEqual([
        "There are no days yet — how should I start planning this trip?",
      ]);
    });

    it("gives the same answer when a stale focused day is still set", () => {
      const trip = tripWith({ dayCount: 0 });
      expect(suggestedQuestions(trip, 0)).toEqual([
        "There are no days yet — how should I start planning this trip?",
      ]);
    });

    // Backlog stops are real, but `/ask`'s read tools cannot see them
    // (read_trip reports days; read_day reports a day's stops). Suggesting a
    // question the assistant is structurally unable to answer is the same
    // failure as suggesting one about absent data.
    it("says nothing about unscheduled stops, which the read tools cannot see", () => {
      const trip = tripWith({ dayCount: 0, unscheduledCount: 5 });
      expect(suggestedQuestions(trip, null).some((q) => /unscheduled|backlog|saved/i.test(q))).toBe(false);
    });
  });

  // "At MOST four" is a claim about all inputs, so it is measured over all
  // inputs rather than over the four hand-written shapes above. The floor is
  // measured, not guessed: this property has no guard clause, so it ticks once
  // per run — 300 runs, floor 150 (half), per witness.ts's rule.
  it("returns at most four non-empty questions for any trip and any focus", () => {
    const w = witness("suggestedQuestions shape");
    fc.assert(
      fc.property(
        fc.record({
          dayCount: fc.integer({ min: 0, max: 6 }),
          activitiesPerDay: fc.integer({ min: 0, max: 4 }),
          unscheduledCount: fc.integer({ min: 0, max: 3 }),
        }),
        fc.option(fc.integer({ min: -2, max: 9 }), { nil: null }),
        fc.integer({ min: 0, max: 5 }),
        (transient, focusedDay, conflictCount) => {
          const base = tripDetailFactory.build({}, { transient });
          const subjects = base.days.flatMap((d) => d.activityIds);
          const trip: TripDetail = {
            ...base,
            conflicts: Array.from({ length: conflictCount }, (_, i) =>
              conflictOn(subjects.length > 0 ? [subjects[i % subjects.length]!] : ["orphan"], `c${i}`),
            ),
          };
          const questions = suggestedQuestions(trip, focusedDay);
          expect(questions.length).toBeLessThanOrEqual(MAX_SUGGESTIONS);
          expect(questions.every((q) => q.trim().length > 0)).toBe(true);
          expect(new Set(questions).size).toBe(questions.length);
          // Every suggestion is a question. A chip that is not one reads as a
          // command the assistant is about to obey.
          expect(questions.every((q) => q.endsWith("?"))).toBe(true);
          w.tick();
        },
      ),
      { numRuns: 300 },
    );
    w.atLeast(150);
  });
});
