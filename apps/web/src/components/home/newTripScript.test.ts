import { describe, expect, it } from "vitest";
import {
  DATE_NOT_YET,
  DATE_YES,
  FEEL_DEFAULT,
  LENGTH_DAYS,
  changeTo,
  commitAnswer,
  commitMulti,
  isComplete,
  questionAt,
  questionsFor,
  togglePick,
  type NewTripState,
} from "./newTripScript";

// Everything that decides WHAT IS ASKED, WHAT COMMITS, and WHAT AN ANSWER MEANS
// lives in one module with no React in it. That is what makes the flow's
// headline property — zero model calls, zero network calls (SPEC §30.2) —
// assertable rather than asserted: there is nothing here that could make one.
const EMPTY: NewTripState = { turn: 0, answers: {}, picked: [] };

const ids = (answers: NewTripState["answers"]) => questionsFor(answers).map((q) => q.id);

describe("the script", () => {
  // `who` was dropped on Mitchell's instruction, 2026-09-15. SPEC.md §30.1 and
  // §32.3 both still list it; that is a recorded delta, and DRIFT.md carries
  // the row. This test is what stops it quietly coming back.
  it("asks in the design's order, with `who` absent", () => {
    expect(ids({})).toEqual(["where", "date", "len", "pace", "feel"]);
  });

  // §32.3: "The question list is derived, not fixed." The day picker exists
  // only for a reader who said they have a date — which is the whole reason
  // that turn is no longer three controls stacked into one.
  it("inserts the day picker only once the date question is answered Yes", () => {
    expect(ids({ date: DATE_YES })).toEqual(["where", "date", "start", "len", "pace", "feel"]);
    expect(ids({ date: DATE_NOT_YET })).toEqual(["where", "date", "len", "pace", "feel"]);
    // Typing a date in prose answers the question without fixing a day, so it
    // takes the undated path — the same line free text takes everywhere else
    // in this script, where parsing it would be the model call §30.2 forbids.
    expect(ids({ date: "sometime in April" })).toEqual(["where", "date", "len", "pace", "feel"]);
  });

  // §32.3: the length turn reads differently once a day is fixed, because
  // "how long, roughly?" is the wrong question to ask somebody who has just
  // told you the exact day they land.
  it("asks the length turn differently once a date is fixed", () => {
    const undated = questionsFor({}).find((q) => q.id === "len")!;
    const dated = questionsFor({ date: DATE_YES }).find((q) => q.id === "len")!;
    expect(undated.ask).toBe("How long, roughly?");
    expect(dated.ask).toBe("And how long are you staying?");
  });

  // §32.3 puts the date input on `start` and NOWHERE else: the old `when` turn
  // carried a length chip row and a date range and a commit button, which is
  // what made it the busiest thing in the flow.
  it("puts a date control on the arrival turn alone", () => {
    const dated = questionsFor({ date: DATE_YES });
    expect(dated.filter((q) => q.dates === true).map((q) => q.id)).toEqual(["start"]);
    expect(questionsFor({}).some((q) => q.dates === true)).toBe(false);
  });

  // D-A (2026-09-16) dropped the label over the destination chips, because
  // "Recent and nearby" is a claim no field on TripSummary or TripDetail can
  // support. SPEC §31.3 then dropped the per-question label from EVERY turn:
  // with the chips inside the composer's own frame it was captioning the
  // obvious. So the field itself is gone rather than empty on one turn.
  it("carries no per-question chip label on any turn", () => {
    for (const question of questionsFor({ date: DATE_YES })) {
      expect(question, `${question.id} still has a chipLabel`).not.toHaveProperty("chipLabel");
    }
    expect(questionsFor({}).find((q) => q.id === "where")!.chips).toContain("Lisbon");
  });

  // §31.3: the placeholder is where "a chip and a typed sentence are the same
  // answer" is said, now that no label says it. `start` is the exception and
  // says its own thing — it has no chips to tap.
  it("tells every chip turn's composer that typing and the chips are one answer", () => {
    for (const question of questionsFor({ date: DATE_YES })) {
      if (question.chips.length === 0) continue;
      expect(question.placeholder, `${question.id}`).toMatch(/tap (one|any) above/);
    }
  });

  // D-B, answered 2026-09-16: 21 confirmed, REVERSING the 2026-08-23 decision
  // that `Longer` has no day count. It is a real fifth chip now.
  it("gives every length chip a real day count, `Longer` included", () => {
    const len = questionsFor({}).find((q) => q.id === "len")!;
    expect(len.chips).toEqual(["Long weekend", "A week", "10 days", "2 weeks", "Longer"]);
    for (const chip of len.chips) {
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
    const s: NewTripState = { turn: 4, answers: { where: "Lisbon" }, picked: [] };
    expect(commitMulti(s).answers.feel).toBe(FEEL_DEFAULT);
  });

  it("commits the picked `feel` chips together, in pick order", () => {
    const s: NewTripState = { turn: 4, answers: {}, picked: ["Food", "Markets"] };
    expect(commitMulti(s).answers.feel).toBe("Food, Markets");
  });

  it("toggles a chip off again, and keeps the rest in their original order", () => {
    const one = togglePick(EMPTY, "Food");
    const two = togglePick(one, "Markets");
    const three = togglePick(two, "Art");
    expect(three.picked).toEqual(["Food", "Markets", "Art"]);
    expect(togglePick(three, "Markets").picked).toEqual(["Food", "Art"]);
  });

  // The question being committed and the length completion is measured against
  // are computed from the SAME answers. Answering the date turn changes the
  // list underneath the turn pointer, and the two must not disagree by one.
  it("keeps the turn pointer on the right question when the list grows", () => {
    const dated = commitAnswer({ turn: 1, answers: { where: "Lisbon" }, picked: [] }, DATE_YES);
    expect(dated.turn).toBe(2);
    expect(questionAt(dated)!.id).toBe("start");

    const undated = commitAnswer(
      { turn: 1, answers: { where: "Lisbon" }, picked: [] },
      DATE_NOT_YET,
    );
    expect(undated.turn).toBe(2);
    expect(questionAt(undated)!.id).toBe("len");
  });
});

describe("Change", () => {
  const ANSWERED: NewTripState = {
    turn: 5,
    answers: { where: "Lisbon", date: DATE_NOT_YET, len: "A week", pace: "Slow", feel: "Food" },
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
    expect(next.answers).toEqual({ ...ANSWERED.answers, where: "Seoul" });
    expect(next.turn).toBe(1);
  });

  // §32.3: "Revising the date question back to *Not yet* must drop the picked
  // day (`ans.start`) with it, or the summary keeps a date the user just
  // removed." Both ways out of Yes drop it — the chip and a typed answer.
  it("drops the picked day when the date question is revised away from Yes", () => {
    const dated: NewTripState = {
      turn: 6,
      answers: { where: "Lisbon", date: DATE_YES, start: "Apr 10, 2027", len: "A week" },
      picked: [],
    };
    expect(commitAnswer(changeTo(dated, 1), DATE_NOT_YET).answers.start).toBeUndefined();
    expect(commitAnswer(changeTo(dated, 1), "not sure yet").answers.start).toBeUndefined();
    // Re-confirming Yes keeps it: that is not a revision, and losing the day
    // would punish somebody for checking their own answer.
    expect(commitAnswer(changeTo(dated, 1), DATE_YES).answers.start).toBe("Apr 10, 2027");
  });

  // Completion is measured against the list the answers imply, so shrinking it
  // must not leave a flow that is finished but still asking, or vice versa.
  it("finishes only when every turn the answers imply has been answered", () => {
    const undated: NewTripState = {
      turn: 5,
      answers: { where: "L", date: DATE_NOT_YET, len: "A week", pace: "Slow", feel: "Food" },
      picked: [],
    };
    expect(isComplete(undated)).toBe(true);
    // The same turn count, with a date in play, is one turn short.
    expect(isComplete({ ...undated, answers: { ...undated.answers, date: DATE_YES } })).toBe(false);
  });
});
