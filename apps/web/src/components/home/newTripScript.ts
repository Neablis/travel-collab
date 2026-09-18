/**
 * **The four-turn New-trip script, and a pure reducer over it.**
 *
 * No React, no `fetch`, no imports from `@/lib`. That is deliberate and it is
 * the point: SPEC §30.2 says the four turns make **zero model calls and zero
 * network calls**, and the only way to make that property assertable rather
 * than merely asserted is to put everything that decides what is asked, what
 * commits and what an answer means somewhere that could not make one.
 *
 * The only traffic the flow may produce is `POST /api/trips` and
 * `POST /api/trips/:id/commands`, and only when an exit is pressed — both of
 * which live in the component, not here.
 */

/** Four, not five. `who` was dropped on Mitchell's instruction, 2026-09-15 —
 *  a recorded delta against `SPEC.md` §30.1, which still says five. */
export type NewTripQuestionId = "where" | "when" | "pace" | "feel";

export interface NewTripQuestion {
  id: NewTripQuestionId;
  ask: string;
  /**
   * The answer dock's text field. **It says that typing and the chips are the
   * same answer** (SPEC §31.3): they are one control, not two, and the chip
   * row sits directly above this field inside the same frame.
   */
  placeholder: string;
  chips: readonly string[];
  /** `when` also offers exact dates, which no other turn does. */
  dates?: boolean;
  /** `feel` takes several answers at once; every other turn takes one. */
  multi?: boolean;
}

/**
 * **Day counts for the length chips.**
 *
 * The design file calls this map `NT_NIGHTS`, and this one is named for days
 * because days is what the product has always meant here: `LENGTH_CHIPS` shipped
 * "Long weekend" as 4 and the design's own New Orleans card reads *"Long
 * weekend, four days"*. Renaming the concept at this boundary would make 4 mean
 * five days on one screen and four on another.
 *
 * `Longer: 21` is **D-B, answered 2026-09-16**, and it reverses the 2026-08-23
 * decision that `Longer` has no day count the design implies. That reversal is
 * why `Longer` is a real chip here instead of the inert Preview badge
 * `NewTripWizard` shipped.
 */
export const LENGTH_DAYS: Readonly<Record<string, number>> = {
  "Long weekend": 4,
  "A week": 7,
  "10 days": 10,
  "2 weeks": 14,
  Longer: 21,
};

/** What `feel` commits when the reader picks nothing and writes nothing. */
export const FEEL_DEFAULT = "A bit of everything";

/**
 * **The line the thread opens with, before any question** (SPEC §31.2).
 *
 * It does two jobs. It states §30.2's contract in the reader's own reading
 * order — nothing is generated, so an abandoned sheet costs nothing — and it
 * means turn one is never an empty pane.
 *
 * **"Four", not the spec's "Five".** §31.2 quotes a five-question line because
 * §30.1 still says five turns; `who` was dropped on Mitchell's instruction,
 * 2026-09-15, and that delta is recorded here and in `DRIFT.md`. Copy that
 * miscounts its own flow is worse than copy that disagrees with a stale spec
 * line, and the reader can count the turns.
 */
export const NEW_TRIP_OPENING =
  "Four quick questions and I will draft the trip. Nothing is generated until the last answer lands.";

export const NEW_TRIP_QUESTIONS: readonly NewTripQuestion[] = [
  {
    id: "where",
    ask: "Where are you going?",
    placeholder: "Type a city, or tap one above",
    chips: ["Lisbon", "Mexico City", "Seoul", "Copenhagen", "Big Sur", "Back to Kyoto"],
  },
  {
    id: "when",
    ask: "How long, roughly?",
    placeholder: "Type a length, or tap one above",
    chips: ["Long weekend", "A week", "10 days", "2 weeks", "Longer"],
    dates: true,
  },
  {
    id: "pace",
    ask: "What pace do you want?",
    placeholder: "Describe the pace, or tap one above",
    chips: ["Slow", "Balanced", "Packed"],
  },
  {
    id: "feel",
    ask: "What is the trip about?",
    placeholder: "Say what it is about, or tap any above",
    chips: [
      "Food",
      "Art",
      "Hiking",
      "Nightlife",
      "Markets",
      "Architecture",
      "With kids",
      "Slow mornings",
    ],
    multi: true,
  },
];

export type NewTripAnswers = Partial<Record<NewTripQuestionId, string>>;

export interface NewTripState {
  /** The turn being asked. `NEW_TRIP_QUESTIONS.length` means all four are in. */
  turn: number;
  answers: NewTripAnswers;
  /** `feel`'s chips, in the order they were picked. Empty on every other turn. */
  picked: readonly string[];
}

export const NEW_TRIP_START: NewTripState = { turn: 0, answers: {}, picked: [] };

function questionAt(turn: number): NewTripQuestion | undefined {
  return NEW_TRIP_QUESTIONS[turn];
}

/**
 * Commit one written or picked answer and move on.
 *
 * **An empty answer is not an answer**, and returning the same state rather
 * than advancing is what stops a blank turn being recorded as one the reader
 * gave. Whitespace counts as empty: a space bar is not a destination.
 */
export function commitAnswer(state: NewTripState, value: string): NewTripState {
  const trimmed = value.trim();
  const question = questionAt(state.turn);
  if (trimmed === "" || question === undefined) return state;
  return {
    turn: state.turn + 1,
    answers: { ...state.answers, [question.id]: trimmed },
    picked: [],
  };
}

/** Add or remove one of `feel`'s chips, keeping the rest in pick order. */
export function togglePick(state: NewTripState, chip: string): NewTripState {
  const picked = state.picked.includes(chip)
    ? state.picked.filter((each) => each !== chip)
    : [...state.picked, chip];
  return { ...state, picked };
}

/**
 * Commit the multi-pick turn.
 *
 * Nothing picked commits `FEEL_DEFAULT` rather than nothing: this is the last
 * turn, and a blank here would leave the closing line describing a trip that is
 * about nothing at all.
 */
export function commitMulti(state: NewTripState): NewTripState {
  const question = questionAt(state.turn);
  if (question === undefined) return state;
  const value = state.picked.length === 0 ? FEEL_DEFAULT : state.picked.join(", ");
  return {
    turn: state.turn + 1,
    answers: { ...state.answers, [question.id]: value },
    picked: [],
  };
}

/**
 * Go back to an earlier turn to change its answer.
 *
 * **Later answers are kept, not cleared** (SPEC §30.1: *"you re-answer
 * forward"*). Clearing them would be the tidier data model and the worse
 * product: a reader who fixes a typo in the city should not lose the three
 * answers they already gave.
 */
export function changeTo(state: NewTripState, turn: number): NewTripState {
  return { ...state, turn, picked: [] };
}
