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
 * which live in the component, not here. **One read joined them in M27 (D13):**
 * after the city, the component asks the library for published days there.
 * It is a read, never a model call, and it never holds the script up; what it
 * found arrives here as data (`offerDays`), so this file still cannot make it.
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
export type NewTripQuestionId = "where" | "pb" | "date" | "start" | "len" | "pace" | "feel";

/**
 * **A published day offered on the Playbook-day turn** (SPEC §35.8, M27 D13).
 *
 * Plain data, handed in: the read that finds these is the component's, and
 * this module only decides what they mean for the script. `author` arrives
 * already said, because saying a person's name is `displayNameFor`'s job and
 * this file imports nothing from `@/lib`.
 */
export interface PopularDay {
  savedDayId: string;
  name: string;
  /** How many trips it has been added to — the ranking, until M12 has ratings. */
  adds: number;
  dayCount: number;
  author: string;
}

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
  /** `feel` and `pb` take several answers at once; every other turn takes one. */
  multi?: boolean;
  /** `pb` offers these days as cards instead of chips. */
  offer?: readonly PopularDay[];
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

/**
 * **The day count for a length answer, or `null` if it is not one of the five.**
 *
 * A function rather than an index, because `LENGTH_DAYS[answer]` reads the
 * PROTOTYPE too: a reader who types `constructor` on the length turn got
 * `Object` back, which is not null, so the closing line rendered function source
 * and `addDaysIso` was handed a `NaN` that throws before the date command is
 * sent (CodeRabbit, PR #188). `Object.hasOwn` is the guard, and it lives here,
 * beside the map, so a second call site cannot reintroduce the same lookup.
 */
export function daysFor(answer: string | undefined): number | null {
  if (answer === undefined || !Object.hasOwn(LENGTH_DAYS, answer)) return null;
  return LENGTH_DAYS[answer] ?? null;
}

/** What `feel` commits when the reader picks nothing and writes nothing. */
export const FEEL_DEFAULT = "A bit of everything";

/**
 * **The line the thread opens with, before any question** (SPEC §31.2, §35.8).
 *
 * It does two jobs. It states §30.2's contract in the reader's own reading
 * order — nothing is made until the last answer, so an abandoned sheet costs
 * nothing — and it means turn one is never an empty pane. Since §35.8 it also
 * says who is asking: the new-trip assistant is **Cass**. (The in-trip panel
 * is still *Assistant*; §35.8 says explicitly not to rename it.)
 *
 * **"A few", never a number.** It used to say "Four quick questions", which was
 * right for a fixed four-turn script and became a bug the moment §32.3 made the
 * list depend on the answers. §32.3 says it outright: *"Nothing may hardcode
 * the count — including the copy."*
 *
 * First run gets its own line (§32.1), because "the trip" has no antecedent on
 * somebody's first screen. It greets them by name only when there is a name
 * worth using — see `firstNameOf` (lib/displayName.ts).
 */
export function openingFor(firstRun: boolean, firstName: string | null = null): string {
  if (!firstRun) {
    return "Hi, it’s Cass. A few quick questions and I’ll draft the trip — nothing is made until your last answer.";
  }
  const hi = firstName === null ? "Hi, I’m Cass." : `Hi ${firstName}, I’m Cass.`;
  return `${hi} I plan trips here — ask me a few things and I’ll draft your first one. Nothing is made until your last answer.`;
}

/**
 * **How long Cass "types" before the next line** (SPEC §35.8, M27 D14).
 *
 * Presentation over a local script: nothing waits on these but the row. D14
 * supersedes §30.2's "do not add a fake delay" on the design's say-so — an
 * answer that lands with no beat reads as a form advancing, not as someone
 * listening. Reduced motion stills the dots; it does not shorten the pause.
 */
export const CASS_TYPING_MS = 750;
/** The longer beat before the draft, labelled `CASS_DRAFTING_LINE`. */
export const CASS_DRAFTING_MS = 1300;
export const CASS_DRAFTING_LINE = "Drafting the trip…";

/** What the Playbook-day turn commits when nothing is picked. */
export const PB_FRESH = "Plan it fresh";

export type NewTripAnswers = Partial<Record<NewTripQuestionId, string>>;

const WHERE: NewTripQuestion = {
  id: "where",
  ask: "Where are you going?",
  placeholder: "Type a city, or tap one above",
  chips: ["Lisbon", "Mexico City", "Seoul", "Copenhagen", "Big Sur", "Back to Kyoto"],
};

/** The city a `where` answer names — "Back to Kyoto" is about Kyoto. */
export function cityOf(where: string | undefined): string {
  return (where ?? "").replace(/^back to /i, "").trim();
}

function playbookQuestion(where: string | undefined, offer: readonly PopularDay[]): NewTripQuestion {
  const city = cityOf(where) || "there";
  // D13: the copy says what the number IS. There are no ratings until M12, so
  // the design's "rated these days highly" would be a claim nothing measured.
  const ask =
    offer.length === 1
      ? `People planning ${city} keep adding this day. Want me to build around it? Or skip, and I’ll plan it fresh.`
      : `People planning ${city} keep adding these days. Want me to build around any of them? Or skip, and I’ll plan it fresh.`;
  return {
    id: "pb",
    ask,
    placeholder: "Or tell me what you want from the days",
    chips: [],
    multi: true,
    offer,
  };
}

/**
 * **Up to three published days worth offering after the city** (M27 D13).
 *
 * Most-added first, at least one add, never the reader's own — offering
 * somebody their own day back as something "people keep adding" is the app
 * describing them to themselves.
 */
export function pickPopularDays(
  days: readonly {
    savedDayId: string;
    name: string;
    adds: number;
    dayCount: number;
    ownerId: string;
    isMine: boolean;
  }[],
  authorOf: (ownerId: string) => string,
): PopularDay[] {
  return days
    .filter((day) => day.adds >= 1 && !day.isMine)
    .sort((a, b) => b.adds - a.adds)
    .slice(0, 3)
    .map((day) => ({
      savedDayId: day.savedDayId,
      name: day.name,
      adds: day.adds,
      dayCount: day.dayCount,
      author: authorOf(day.ownerId),
    }));
}

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
 * the bug this shape makes unrepresentable. §35.8's offer is a third input for
 * the same reason, and it lives in the state beside the answers rather than
 * next to it.
 */
export function questionsFor(
  answers: NewTripAnswers,
  offer: readonly PopularDay[] = [],
): readonly NewTripQuestion[] {
  const dated = answers.date === DATE_YES;
  return [
    WHERE,
    // **Asked only when there is something to offer** (§35.8): skipped
    // entirely when the city has no published days, when the read failed, or
    // when it had not come back by the time the typing row ended.
    ...(offer.length > 0 ? [playbookQuestion(answers.where, offer)] : []),
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
  /** The multi turn's picks, in pick order — `feel`'s chips, or `pb`'s
   *  savedDayIds. Empty on every other turn. */
  picked: readonly string[];
  /**
   * The Playbook days on offer for the answered city, frozen by `offerDays`
   * when the typing row after `where` ends (M27 D13). Absent until then, and
   * empty for good when there was nothing to offer. It decides whether `pb` is
   * in the list, so it is state every turn index is measured against.
   */
  offer?: readonly PopularDay[];
  /** The savedDayIds the `pb` turn chose, inserted once the trip exists. */
  chosen?: readonly string[];
}

export const NEW_TRIP_START: NewTripState = { turn: 0, answers: {}, picked: [] };

/** The list this state's turn indexes into. */
export function questionsOf(state: NewTripState): readonly NewTripQuestion[] {
  return questionsFor(state.answers, state.offer);
}

/** The question a state is standing on, or `undefined` once the flow is done. */
export function questionAt(state: NewTripState): NewTripQuestion | undefined {
  return questionsOf(state)[state.turn];
}

/** Every turn answered — measured against the list THESE answers imply. */
export function isComplete(state: NewTripState): boolean {
  return state.turn >= questionsOf(state).length;
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
  const next: NewTripState = { ...state, turn: state.turn + 1, answers, picked: [] };
  // Words typed on the Playbook-day turn pick no day: a sentence is not a
  // savedDayId, and reading one into it would be the model call §30.2 bars.
  if (question.id === "pb") return { ...next, chosen: [] };
  if (question.id === "where") return withoutOffer(next, trimmed !== state.answers.where);
  return next;
}

/**
 * **A `where` answer takes the old offer with it** until `offerDays` freezes a
 * new one, so no `pb` turn can be asked about the wrong place in between. A
 * DIFFERENT city also drops what was chosen for the old one — those days are
 * somewhere else.
 */
function withoutOffer(state: NewTripState, cityChanged: boolean): NewTripState {
  const next: NewTripState = { turn: state.turn, answers: { ...state.answers }, picked: state.picked };
  if (cityChanged) {
    delete next.answers.pb;
  } else if (state.chosen !== undefined) {
    next.chosen = state.chosen;
  }
  return next;
}

/**
 * **Freeze the offer for the answered city** (M27 D13) — called when the typing
 * row after `where` ends, with whatever the read had found by then, which is
 * `[]` when it had found nothing, failed, or not come back.
 *
 * A pick that is not in the new offer cannot be honoured, so the `pb` answer
 * and its days go together; an empty offer removes the turn, and the answer
 * with it, rather than inserting days nobody was shown this time.
 */
export function offerDays(state: NewTripState, offer: readonly PopularDay[]): NewTripState {
  const offered = new Set(offer.map((day) => day.savedDayId));
  const chosen = state.chosen ?? [];
  if (offer.length > 0 && chosen.every((id) => offered.has(id))) {
    // Re-asked after the same city was confirmed: the picks are still ticked.
    const asking = questionsFor(state.answers, offer)[state.turn]?.id === "pb";
    return { ...state, offer, picked: asking ? chosen : state.picked };
  }
  const answers = { ...state.answers };
  delete answers.pb;
  return { ...state, offer, answers, chosen: [] };
}

/** Add or remove one pick — a `feel` chip or a `pb` day — keeping the rest in pick order. */
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
  if (question.offer !== undefined) {
    // The answer said in the thread is the days' NAMES; what the trip gets is
    // their ids. Nothing picked is the reader choosing a fresh plan.
    const byId = new Map(question.offer.map((day) => [day.savedDayId, day.name]));
    const chosen = state.picked.filter((id) => byId.has(id));
    const names = chosen.map((id) => byId.get(id)!);
    return {
      ...state,
      turn: state.turn + 1,
      answers: { ...state.answers, [question.id]: names.length === 0 ? PB_FRESH : names.join(", ") },
      picked: [],
      chosen,
    };
  }
  const value = state.picked.length === 0 ? FEEL_DEFAULT : state.picked.join(", ");
  return {
    ...state,
    turn: state.turn + 1,
    answers: { ...state.answers, [question.id]: value },
    picked: [],
  };
}

/**
 * **The one-clause acknowledgement Cass puts before the next question**
 * (SPEC §35.8): *"so it reads like someone listening, not a form advancing.
 * Never gushing; one clause at most."*
 *
 * Keyed on the CHIP where a chip has a meaning. "Balanced it is." is a fine
 * thing to say to *Balanced* and a strange one to say to somebody who typed
 * "whatever the kids can manage", so words no chip covers get a plain
 * "Got it." `who` has no line because it has no turn (M27 D15). The date turn
 * says nothing to *Yes*: the next line is already about the date.
 */
export function acknowledge(id: NewTripQuestionId, answer: string, chosen = 0): string {
  switch (id) {
    case "where":
      return /^back to /i.test(answer) ? `${cityOf(answer)} again — good.` : `${answer}, good.`;
    case "pb":
      if (answer === PB_FRESH) return "Fresh it is.";
      if (chosen === 0) return "Got it.";
      return chosen === 1 ? "I’ll build the rest around that one." : "I’ll build the rest around those.";
    case "date":
      // Anything but Yes leaves the trip undated — a typed date is not parsed
      // (§30.2) — so "dates can come later" is true of every other answer.
      return answer === DATE_YES ? "" : "No problem — dates can come later.";
    case "len":
      return "Got it.";
    case "pace":
      if (answer === "Slow") return "Slow — fewer stops, longer lunches.";
      if (answer === "Packed") return "Packed — I’ll keep the travel between stops tight.";
      return answer === "Balanced" ? "Balanced it is." : "Got it.";
    case "start":
    case "feel":
      return "";
  }
}

/**
 * **A question as Cass says it: the acknowledgement of the answer before it,
 * then the question.** The composer's accessible name stays `question.ask`
 * alone — the acknowledgement is conversation, not the field's label.
 */
export function spokenAsk(state: NewTripState, index: number): string {
  const questions = questionsOf(state);
  const question = questions[index];
  if (question === undefined) return "";
  const previous = index > 0 ? questions[index - 1] : undefined;
  const answer = previous === undefined ? undefined : state.answers[previous.id];
  const ack =
    previous === undefined || answer === undefined
      ? ""
      : acknowledge(previous.id, answer, state.chosen?.length ?? 0);
  return ack === "" ? question.ask : `${ack} ${question.ask}`;
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
 * find it with `questionsOf(state)` rather than off a constant: when the date
 * answer or the offer changes, the list grows or shrinks by one and every index
 * after it moves.
 *
 * Going back to the Playbook-day turn re-opens its picks as they were, so a
 * reader checking their answer does not have to find the days again.
 */
export function changeTo(state: NewTripState, turn: number): NewTripState {
  const back = questionsOf(state)[turn];
  return { ...state, turn, picked: back?.id === "pb" ? (state.chosen ?? []) : [] };
}
