import { describe, expect, it } from "vitest";
import {
  FEEL_DEFAULT,
  LENGTH_DAYS,
  NEW_TRIP_QUESTIONS,
  changeTo,
  commitAnswer,
  commitMulti,
  togglePick,
  type NewTripState,
} from "./newTripScript";

// Everything that decides WHAT IS ASKED, WHAT COMMITS, and WHAT AN ANSWER MEANS
// lives in one module with no React in it. That is what makes the four turns'
// headline property — zero model calls, zero network calls (SPEC §30.2) —
// assertable rather than asserted: there is nothing here that could make one.
const EMPTY: NewTripState = { turn: 0, answers: {}, picked: [] };

describe("the four-turn script", () => {
  // `who` was dropped on Mitchell's instruction, 2026-09-15. SPEC.md §30.1
  // still says five turns; that is a recorded delta, and DRIFT.md is owed the
  // row. This test is what stops the fifth quietly coming back.
  it("has exactly four turns, in the design's order, with `who` absent", () => {
    expect(NEW_TRIP_QUESTIONS.map((q) => q.id)).toEqual(["where", "when", "pace", "feel"]);
  });

  // D-A (2026-09-16) dropped the label over the destination chips, because
  // "Recent and nearby" is a claim no field on TripSummary or TripDetail can
  // support. SPEC §31.3 then dropped the per-question label from EVERY turn:
  // with the chips inside the composer's own frame it was captioning the
  // obvious. So the field itself is gone rather than empty on one turn, and
  // this asserts the shape rather than a value.
  it("carries no per-question chip label on any turn", () => {
    for (const question of NEW_TRIP_QUESTIONS) {
      expect(question, `${question.id} still has a chipLabel`).not.toHaveProperty("chipLabel");
      expect(question.chips.length, `${question.id} has no chips`).toBeGreaterThan(0);
    }
    expect(NEW_TRIP_QUESTIONS.find((q) => q.id === "where")!.chips).toContain("Lisbon");
  });

  // §31.3: the placeholder is where "a chip and a typed sentence are the same
  // answer" is said, now that no label says it.
  it("tells every turn's composer that typing and the chips are one answer", () => {
    for (const question of NEW_TRIP_QUESTIONS) {
      expect(question.placeholder, `${question.id}`).toMatch(/tap (one|any) above/);
    }
  });

  // D-B, answered 2026-09-16: 21 confirmed, REVERSING the 2026-08-23 decision
  // that `Longer` has no day count. It is a real fifth chip now.
  it("gives every length chip a real day count, `Longer` included", () => {
    const when = NEW_TRIP_QUESTIONS.find((q) => q.id === "when")!;
    expect(when.chips).toEqual(["Long weekend", "A week", "10 days", "2 weeks", "Longer"]);
    for (const chip of when.chips) {
      expect(LENGTH_DAYS[chip], `${chip} has no day count`).toBeGreaterThan(0);
    }
    expect(LENGTH_DAYS.Longer).toBe(21);
  });
});

describe("committing an answer", () => {
  it("does not commit an empty or whitespace-only answer", () => {
    expect(commitAnswer(EMPTY, "")).toEqual(EMPTY);
    expect(commitAnswer(EMPTY, "   ")).toEqual(EMPTY);
    expect(commitAnswer(EMPTY, "\n\t ")).toEqual(EMPTY);
  });

  it("trims what it does commit, and advances one turn", () => {
    expect(commitAnswer(EMPTY, "  Lisbon  ")).toEqual({
      turn: 1,
      answers: { where: "Lisbon" },
      picked: [],
    });
  });

  it("commits `feel` as the default when nothing is picked", () => {
    const s: NewTripState = { turn: 3, answers: { where: "Lisbon" }, picked: [] };
    expect(commitMulti(s).answers.feel).toBe(FEEL_DEFAULT);
  });

  it("commits the picked `feel` chips together, in pick order", () => {
    const s: NewTripState = { turn: 3, answers: {}, picked: ["Food", "Markets"] };
    expect(commitMulti(s).answers.feel).toBe("Food, Markets");
  });

  it("toggles a chip off again, and keeps the rest in their original order", () => {
    const one = togglePick(EMPTY, "Food");
    const two = togglePick(one, "Markets");
    const three = togglePick(two, "Art");
    expect(three.picked).toEqual(["Food", "Markets", "Art"]);
    expect(togglePick(three, "Markets").picked).toEqual(["Food", "Art"]);
  });
});

describe("Change", () => {
  const ANSWERED: NewTripState = {
    turn: 4,
    answers: { where: "Lisbon", when: "A week", pace: "Slow", feel: "Food" },
    picked: [],
  };

  // SPEC §30.1: "Later answers are kept, not cleared — you re-answer forward."
  it("returns to a turn and keeps every later answer", () => {
    const back = changeTo(ANSWERED, 0);
    expect(back.turn).toBe(0);
    expect(back.answers).toEqual(ANSWERED.answers);
    expect(back.picked).toEqual([]);
  });

  it("re-answering an earlier turn overwrites only that answer", () => {
    const next = commitAnswer(changeTo(ANSWERED, 0), "Seoul");
    expect(next.answers).toEqual({ where: "Seoul", when: "A week", pace: "Slow", feel: "Food" });
    expect(next.turn).toBe(1);
  });
});
