import { describe, expect, it } from "vitest";
import {
  DATE_NOT_YET,
  DATE_YES,
  FEEL_DEFAULT,
  LENGTH_DAYS,
  PB_FRESH,
  acknowledge,
  changeTo,
  daysFor,
  commitAnswer,
  commitMulti,
  firstNameOf,
  isComplete,
  offerDays,
  openingFor,
  pickPopularDays,
  questionAt,
  questionsFor,
  questionsOf,
  spokenAsk,
  togglePick,
  type NewTripState,
  type PopularDay,
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

  // **A length answer is one of five strings, not any key on an object.**
  // `LENGTH_DAYS["constructor"]` reads the prototype and returns `Object`, so a
  // reader who typed `constructor` on the length turn got a function where a
  // day count belongs: the closing line rendered its source, and `addDaysIso`
  // was handed a NaN that throws before the date command is sent (CodeRabbit,
  // PR #188). The guard lives beside the map so no call site can skip it.
  it("reads no day count off the prototype", () => {
    expect(daysFor("A week")).toBe(7);
    expect(daysFor(undefined)).toBeNull();
    expect(daysFor("nine nights")).toBeNull();
    for (const inherited of ["constructor", "toString", "hasOwnProperty", "__proto__"]) {
      expect(daysFor(inherited), `${inherited} is not a length`).toBeNull();
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
    const revised = commitAnswer(changeTo(dated, 1), DATE_NOT_YET);
    expect(revised.answers.start).toBeUndefined();
    // **And only the day goes.** §30.1's "you re-answer forward" still holds
    // across this revision: the length answered AFTER the date survives it.
    // The component test that covers the same walk cannot assert this — the
    // shrunken list leaves `len` being re-asked, so it has no user turn on
    // screen — which is exactly why the claim is enforced here instead
    // (CodeRabbit, PR #188: a comment asserting an invariant with no test
    // behind it is KI-1/KI-14's defect class).
    expect(revised.answers.len).toBe("A week");
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

// SPEC §35.8 + M27 D13: the Playbook-day turn. The offer is DATA handed to the
// script, so everything it decides is assertable here without a network.
describe("the Playbook-day turn", () => {
  const TRAM: PopularDay = { savedDayId: "tram", name: "Tram 28 morning", adds: 12, dayCount: 1, author: "Mei" };
  const ALFAMA: PopularDay = { savedDayId: "alfama", name: "Alfama at dusk", adds: 3, dayCount: 2, author: "Mei" };
  const AT_PB: NewTripState = { turn: 1, answers: { where: "Lisbon" }, picked: [], offer: [TRAM, ALFAMA] };

  it("is asked after the city only when there is something to offer", () => {
    expect(ids({ where: "Lisbon" })).toEqual(["where", "date", "len", "pace", "feel"]);
    expect(questionsFor({ where: "Lisbon" }, [TRAM]).map((q) => q.id)).toEqual([
      "where",
      "pb",
      "date",
      "len",
      "pace",
      "feel",
    ]);
  });

  it("says what the number is, in the singular and the plural", () => {
    expect(questionsFor({ where: "Back to Kyoto" }, [TRAM])[1]!.ask).toBe(
      "People planning Kyoto keep adding this day. Want me to build around it? Or skip, and I’ll plan it fresh.",
    );
    expect(questionsFor({ where: "Lisbon" }, [TRAM, ALFAMA])[1]!.ask).toBe(
      "People planning Lisbon keep adding these days. Want me to build around any of them? Or skip, and I’ll plan it fresh.",
    );
  });

  it("commits the picked days' names as the answer, and their ids as the choice", () => {
    const next = commitMulti(togglePick(togglePick(AT_PB, "alfama"), "tram"));
    expect(next.answers.pb).toBe("Alfama at dusk, Tram 28 morning");
    expect(next.chosen).toEqual(["alfama", "tram"]);
    expect(questionAt(next)!.id).toBe("date");
  });

  it("commits a fresh plan, and no days, when nothing is picked or words are typed", () => {
    expect(commitMulti(AT_PB).answers.pb).toBe(PB_FRESH);
    expect(commitMulti(AT_PB).chosen).toEqual([]);
    const typed = commitAnswer({ ...AT_PB, chosen: ["tram"] }, "somewhere with a view");
    expect(typed.answers.pb).toBe("somewhere with a view");
    expect(typed.chosen).toEqual([]);
  });

  // A new city's read has not come back yet when its `where` commits; until
  // `offerDays` freezes it there is no offer, so no turn about the old city.
  it("drops the old offer on a new city, and the old picks with it", () => {
    const chose = commitMulti(togglePick(AT_PB, "tram"));
    const moved = commitAnswer(changeTo(chose, 0), "Porto");
    expect(moved.offer).toBeUndefined();
    expect(moved.answers.pb).toBeUndefined();
    expect(moved.chosen).toBeUndefined();
    // Re-confirming the SAME city keeps what was chosen there.
    expect(commitAnswer(changeTo(chose, 0), "Lisbon").chosen).toEqual(["tram"]);
  });

  it("freezes an empty offer as no turn, and drops picks the new offer cannot honour", () => {
    const chose: NewTripState = {
      ...AT_PB,
      turn: 2,
      answers: { where: "Lisbon", pb: "Tram 28 morning" },
      chosen: ["tram"],
    };
    const none = offerDays(chose, []);
    expect(questionsOf(none).map((q) => q.id)).not.toContain("pb");
    expect(none.answers.pb).toBeUndefined();
    expect(none.chosen).toEqual([]);

    expect(offerDays(chose, [ALFAMA]).chosen).toEqual([]);
    expect(offerDays(chose, [TRAM, ALFAMA]).chosen).toEqual(["tram"]);
  });

  it("re-opens the picks as they were when going back to the turn", () => {
    const chose = commitMulti(togglePick(AT_PB, "tram"));
    expect(changeTo(chose, 1).picked).toEqual(["tram"]);
    expect(changeTo(chose, 0).picked).toEqual([]);
  });

  it("offers up to three days with at least one add, most-added first, never the reader's own", () => {
    const day = (savedDayId: string, adds: number, isMine = false) => ({
      savedDayId,
      name: savedDayId,
      adds,
      dayCount: 1,
      ownerId: `owner-${savedDayId}`,
      isMine,
    });
    const offered = pickPopularDays(
      [day("a", 2), day("b", 0), day("c", 40, true), day("d", 9), day("e", 5), day("f", 1)],
      (ownerId) => ownerId.toUpperCase(),
    );
    expect(offered.map((each) => each.savedDayId)).toEqual(["d", "e", "a"]);
    expect(offered[0]!.author).toBe("OWNER-D");
  });
});

describe("Cass's lines", () => {
  it("acknowledges each answer in one clause, and says nothing to Yes", () => {
    expect(acknowledge("where", "Lisbon")).toBe("Lisbon, good.");
    expect(acknowledge("where", "Back to Kyoto")).toBe("Kyoto again — good.");
    expect(acknowledge("pb", PB_FRESH)).toBe("Fresh it is.");
    expect(acknowledge("pb", "Tram 28 morning", 1)).toBe("I’ll build the rest around that one.");
    expect(acknowledge("pb", "Tram 28 morning, Alfama at dusk", 2)).toBe("I’ll build the rest around those.");
    expect(acknowledge("date", DATE_YES)).toBe("");
    expect(acknowledge("date", DATE_NOT_YET)).toBe("No problem — dates can come later.");
    expect(acknowledge("len", "A week")).toBe("Got it.");
    expect(acknowledge("pace", "Slow")).toBe("Slow — fewer stops, longer lunches.");
    expect(acknowledge("pace", "Packed")).toBe("Packed — I’ll keep the travel between stops tight.");
    expect(acknowledge("pace", "Balanced")).toBe("Balanced it is.");
    // Words no chip covers get the plain line, not a chip's.
    expect(acknowledge("pace", "whatever the kids can manage")).toBe("Got it.");
    expect(acknowledge("feel", "Food")).toBe("");
  });

  it("puts the acknowledgement before the question it answers into", () => {
    const state: NewTripState = { turn: 2, answers: { where: "Lisbon", date: DATE_NOT_YET }, picked: [] };
    expect(spokenAsk(state, 0)).toBe("Where are you going?");
    expect(spokenAsk(state, 1)).toBe("Lisbon, good. Do you have a start date in mind?");
    expect(spokenAsk(state, 2)).toBe("No problem — dates can come later. How long, roughly?");
  });

  it("opens as Cass, and greets a first run by a name only when there is one", () => {
    expect(openingFor(false)).toBe(
      "Hi, it’s Cass. A few quick questions and I’ll draft the trip — nothing is made until your last answer.",
    );
    expect(openingFor(true, "Sam")).toBe(
      "Hi Sam, I’m Cass. I plan trips here — ask me a few things and I’ll draft your first one. Nothing is made until your last answer.",
    );
    expect(openingFor(true, null)).toMatch(/^Hi, I’m Cass\. I plan trips here/);
  });

  it("takes a first name from a real name only", () => {
    expect(firstNameOf("Sam Rivera", "Traveler 4f2a91")).toBe("Sam");
    expect(firstNameOf("Traveler 4f2a91", "Traveler 4f2a91")).toBeNull();
    expect(firstNameOf("sam@example.com", "Traveler 4f2a91")).toBeNull();
    expect(firstNameOf("   ", "Traveler 4f2a91")).toBeNull();
  });
});
