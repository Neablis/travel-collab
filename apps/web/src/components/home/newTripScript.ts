/**
 * **The New-trip script, and a pure reducer over it.**
 *
 * No React, no `fetch`, no imports from `@/lib`. That is deliberate and it is
 * the point: SPEC §30.2 says the turns make **zero model calls and zero
 * network calls**, and the only way to make that property assertable rather
 * than merely asserted is to put everything that decides what is asked, what
 * commits and what an answer means somewhere that could not make one.
 *
 * The only traffic the flow may produce is `POST /api/trips` and
 * `POST /api/trips/:id/commands`, and only when an exit is pressed — both of
 * which live in the component, not here.
 *
 * **The list is derived, not fixed** (SPEC §32.3, 2026-09-18). Answering *Yes*
 * to "do you have a start date" inserts the day-picker turn, so the flow is
 * five turns without a date and six with one. `questionsFor` is the only place
 * that knows, and nothing may hardcode the count — including the copy.
 */

/**
 * `who` was dropped on Mitchell's instruction, 2026-09-15 — a recorded delta
 * against `SPEC.md` §30.1 and §32.3, both of which still list it.
 *
 * `date`, `start` and `len` are §32.3: what used to be one `when` turn is now
 * "do you have a start date", an optional day picker, and a length. The old
 * turn carried a length chip row *and* an arrive→leave range *and* a *Use
 * these* button — three controls for one answer — and it modelled a trip as a
 * date range while every other surface in this app models it as a start date
 * plus a length.
 */
export type NewTripQuestionId = "where" | "date" | "start" | "len" | "pace" | "feel";

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
  /** `start` offers a day picker, which no other turn does. */
  dates?: boolean;
  /** `feel` takes several answers at once; every other turn takes one. */
  multi?: boolean;
}

/** The one answer to `date` that inserts the day picker. Compared by value in
 *  `questionsFor` and in `commitAnswer`, so it is named once. */
export const DATE_YES = "Yes";
export const DATE_NOT_YET = "Not yet";

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
 * **"A few", never a number.** It used to say "Four quick questions", which was
 * right for a fixed four-turn script and became a bug the moment §32.3 made the
 * list depend on the answers. §32.3 says it outright: *"Nothing may hardcode
 * the count — including the copy."*
 */
export const NEW_TRIP_OPENING =
  "A few quick questions and I will draft the trip. Nothing is generated until the last answer lands.";

/** §32.1: first run gets its own line, because there is no app behind this one
 *  yet and "the trip" has no antecedent on somebody's first screen. */
export const NEW_TRIP_OPENING_FIRST_RUN =
  "Welcome. A few quick questions and I will draft your first trip. " +
  "Nothing is generated until the last answer lands.";

export type NewTripAnswers = Partial<Record<NewTripQuestionId, string>>;

const WHERE: NewTripQuestion = {
  id: "where",
  ask: "Where are you going?",
  placeholder: "Type a city, or tap one above",
  chips: ["Lisbon", "Mexico City", "Seoul", "Copenhagen", "Big Sur", "Back to Kyoto"],
};

const DATE: NewTripQuestion = {
  id: "date",
  ask: "Do you have a start date in mind?",
  placeholder: "Say when, or tap one above",
  chips: [DATE_YES, DATE_NOT_YET],
};

const START: NewTripQuestion = {
  id: "start",
  ask: "When do you arrive?",
  placeholder: "Or describe it — early April",
  chips: [],
  dates: true,
};

const PACE: NewTripQuestion = {
  id: "pace",
  ask: "What pace do you want?",
  placeholder: "Describe the pace, or tap one above",
  chips: ["Slow", "Balanced", "Packed"],
};

const FEEL: NewTripQuestion = {
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
};

/**
 * **The turns, for these answers** (SPEC §32.3).
 *
 * Two things depend on what has been said so far: whether the day picker is in
 * the list at all, and how the length turn asks — *"And how long are you
 * staying?"* once a date is fixed, *"How long, roughly?"* when it is not.
 *
 * Called with the answers rather than read off a module constant so that the
 * question a reducer is committing and the length it measures completion
 * against are both computed from the SAME answers. A list captured before a
 * commit and a list captured after it disagree by exactly one turn, which is
 * the bug this shape makes unrepresentable.
 */
export function questionsFor(answers: NewTripAnswers): readonly NewTripQuestion[] {
  const dated = answers.date === DATE_YES;
  return [
    WHERE,
    DATE,
    ...(dated ? [START] : []),
    {
      id: "len",
      ask: dated ? "And how long are you staying?" : "How long, roughly?",
      placeholder: "Type a length, or tap one above",
      chips: ["Long weekend", "A week", "10 days", "2 weeks", "Longer"],
    },
    PACE,
    FEEL,
  ];
}

export interface NewTripState {
  /** The turn being asked. `questionsFor(answers).length` means they are all in. */
  turn: number;
  answers: NewTripAnswers;
  /** `feel`'s chips, in the order they were picked. Empty on every other turn. */
  picked: readonly string[];
}

export const NEW_TRIP_START: NewTripState = { turn: 0, answers: {}, picked: [] };

/** The question a state is standing on, or `undefined` once the flow is done. */
export function questionAt(state: NewTripState): NewTripQuestion | undefined {
  return questionsFor(state.answers)[state.turn];
}

/** Every turn answered — measured against the list THESE answers imply. */
export function isComplete(state: NewTripState): boolean {
  return state.turn >= questionsFor(state.answers).length;
}

/**
 * Commit one written or picked answer and move on.
 *
 * **An empty answer is not an answer**, and returning the same state rather
 * than advancing is what stops a blank turn being recorded as one the reader
 * gave. Whitespace counts as empty: a space bar is not a destination.
 *
 * **Revising the date question away from *Yes* takes the picked day with it**
 * (SPEC §32.3). Without that, going back and saying "not yet" left `start`
 * behind, and the closing line kept a date the reader had just removed.
 */
export function commitAnswer(state: NewTripState, value: string): NewTripState {
  const trimmed = value.trim();
  const question = questionAt(state);
  if (trimmed === "" || question === undefined) return state;
  const answers: NewTripAnswers = { ...state.answers, [question.id]: trimmed };
  if (question.id === "date" && trimmed !== DATE_YES) delete answers.start;
  return { turn: state.turn + 1, answers, picked: [] };
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
  const question = questionAt(state);
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
 *
 * The turn is an INDEX into the list these answers imply, which is why callers
 * find it with `questionsFor(state.answers)` rather than off a constant: when
 * the date answer changes, the list grows or shrinks by one and every index
 * after it moves.
 */
export function changeTo(state: NewTripState, turn: number): NewTripState {
  return { ...state, turn, picked: [] };
}
