import type { ActivityTagDescribed, TripPace } from "@tc/contracts";

/**
 * **New trip's pages, and a pure reducer over them** (M56 part 2, ADR-084 §1).
 *
 * No React, no `fetch`, no imports from `@/lib`. It was a scripted chat until
 * M56; it is five pages and a Review now, and the reason it stays here is the
 * one it always had: everything that decides what is asked, what counts as an
 * answer and what reaches the trip sits where nothing could make a model call
 * or a network call (SPEC §30.2). The one read the flow makes, the published
 * days for the chosen place, is the component's; what it found arrives here as
 * data (`offerDays`).
 *
 * **Every answer is a pick.** There is no free text: Where takes a place a
 * search returned (`NewTripPlace` is built from a result, never from what was
 * typed), and every other page answers with options, a date, a count or tags.
 */

/** The five pages, in order. Review comes after the last. */
export const NEW_TRIP_PAGES = ["where", "start", "length", "pace", "about"] as const;
export type NewTripPageId = (typeof NEW_TRIP_PAGES)[number];

/** `page` once every page is behind the reader. */
export const REVIEW = NEW_TRIP_PAGES.length;

/**
 * **A place a search returned** — a library city or country, or a world place
 * (M56 D3). `id` is the result's own key, so two places with one name stay
 * two; `label` is what the trip is named.
 */
export interface NewTripPlace {
  id: string;
  label: string;
  /** What tells two same-named world places apart: their region. */
  detail?: string;
  kind: "city" | "country" | "world";
  countryCode?: string;
  /** Published days touch it, so Review may offer some (D9). */
  hasPlaybooks: boolean;
}

/**
 * **A published day Review offers to start from** (M27 D13, M56 D9).
 *
 * Plain data, handed in: `author` is the day's `ownerDisplayName`, already
 * said by the server (`publicNameFor`).
 */
export interface PopularDay {
  savedDayId: string;
  name: string;
  /** How many trips it has been added to — the ranking, until M12 has ratings. */
  adds: number;
  dayCount: number;
  author: string;
}

/** `iso: null` is *Yes, pick a day* with no day picked yet, which is not an answer. */
export type StartAnswer = "not-yet" | { iso: string | null };

export interface NewTripAnswers {
  where?: NewTripPlace;
  start?: StartAnswer;
  /** `other` when the − / + counter set it rather than a chip, so the page reopens on the counter. */
  length?: { days: number; other: boolean };
  pace?: TripPace;
  /** Any or none: an empty list is an answer. */
  about: readonly ActivityTagDescribed[];
}

export interface NewTripState {
  /** The page being shown: an index into `NEW_TRIP_PAGES`, or `REVIEW`. */
  page: number;
  answers: NewTripAnswers;
  /** True when Review's *Change* opened this page, so it goes back to Review. */
  fromReview: boolean;
  /**
   * The place Review's *Change* left, while Where is open from Review. A
   * different pick re-walks the later pages instead of returning.
   */
  leftWhere?: NewTripPlace;
  /** Set by changing Where from Review, until the re-walk reaches Review again. */
  destinationChanged: boolean;
  /** Published days for `answers.where`, frozen by `offerDays`. */
  offer: readonly PopularDay[];
  /** The offered days the reader chose to start from, in offer order. */
  chosen: readonly string[];
}

export const NEW_TRIP_START: NewTripState = {
  page: 0,
  answers: { about: [] },
  fromReview: false,
  destinationChanged: false,
  offer: [],
  chosen: [],
};

/**
 * **Day counts for the length chips.**
 *
 * Named for days, not nights, because days is what the product has always
 * meant here: *"Long weekend, four days"* is the design's own card. `Longer: 21`
 * is D-B, answered 2026-09-16. M56 keeps these five and adds the counter for
 * any other length (plan, *Settled in the plan*).
 */
export const LENGTH_DAYS: Readonly<Record<string, number>> = {
  "Long weekend": 4,
  "A week": 7,
  "10 days": 10,
  "2 weeks": 14,
  Longer: 21,
};

/**
 * **The day count for a chip, or `null` if it is not one of the five.**
 *
 * A function rather than an index, because `LENGTH_DAYS[answer]` reads the
 * PROTOTYPE too: `constructor` gave back `Object` (CodeRabbit, PR 188).
 */
export function daysFor(chip: string | undefined): number | null {
  if (chip === undefined || !Object.hasOwn(LENGTH_DAYS, chip)) return null;
  return LENGTH_DAYS[chip] ?? null;
}

/** The chip a length came from, when it is one; the counter's own lengths have none. */
export function chipFor(length: NewTripAnswers["length"]): string | null {
  if (length === undefined || length.other) return null;
  return Object.keys(LENGTH_DAYS).find((chip) => LENGTH_DAYS[chip] === length.days) ?? null;
}

/** The counter's bounds. No contract caps a trip; two months is past any trip this flow is for. */
export const LENGTH_MIN = 1;
export const LENGTH_MAX = 60;

/** Whether `page` holds an answer the reader may move on from. */
export function isAnswered(answers: NewTripAnswers, page: NewTripPageId): boolean {
  switch (page) {
    case "where":
      return answers.where !== undefined;
    case "start":
      return answers.start === "not-yet" || (answers.start !== undefined && answers.start.iso !== null);
    case "length":
      return answers.length !== undefined;
    case "pace":
      return answers.pace !== undefined;
    case "about":
      return true;
  }
}

/** The page the state is on, or `"review"`. */
export function pageOf(state: NewTripState): NewTripPageId | "review" {
  return NEW_TRIP_PAGES[state.page] ?? "review";
}

/**
 * **Record what the current page's control now holds.**
 *
 * A different place takes the offer and the chosen days with it — those days
 * are somewhere else — until `offerDays` freezes the new place's.
 */
export function answer(state: NewTripState, patch: Partial<NewTripAnswers>): NewTripState {
  const answers = { ...state.answers, ...patch };
  if (patch.where !== undefined && patch.where.id !== state.answers.where?.id) {
    return { ...state, answers, offer: [], chosen: [] };
  }
  return { ...state, answers };
}

/**
 * **Move on from the current page**, and refuse to while it is unanswered.
 *
 * From a page Review's *Change* opened, that is back to Review — except Where
 * with a different place, which re-walks the later pages with their answers
 * kept, under *Destination changed*: a length or a pace picked for one place
 * is worth a second look for another.
 */
export function next(state: NewTripState): NewTripState {
  const page = NEW_TRIP_PAGES[state.page];
  if (page === undefined || !isAnswered(state.answers, page)) return state;
  if (state.fromReview) {
    const { leftWhere, ...rest } = state;
    const moved = page === "where" && state.answers.where?.id !== leftWhere?.id;
    return moved
      ? { ...rest, fromReview: false, page: 1, destinationChanged: true }
      : { ...rest, fromReview: false, page: REVIEW };
  }
  const to = state.page + 1;
  return to === REVIEW ? { ...state, page: REVIEW, destinationChanged: false } : { ...state, page: to };
}

/** One page back. Not from Where, which has nothing before it. */
export function back(state: NewTripState): NewTripState {
  return state.page === 0 ? state : { ...state, page: state.page - 1 };
}

/** **Review's *Change***: open that page, to come back to Review. */
export function changeTo(state: NewTripState, page: NewTripPageId): NewTripState {
  const index = NEW_TRIP_PAGES.indexOf(page);
  const opened: NewTripState = { ...state, page: index, fromReview: true };
  if (page === "where" && state.answers.where !== undefined) opened.leftWhere = state.answers.where;
  return opened;
}

/** "Step 2 of 5", for a page; Review has no step. */
export function stepLabel(state: NewTripState): string | null {
  return state.page < REVIEW ? `Step ${state.page + 1} of ${NEW_TRIP_PAGES.length}` : null;
}

/**
 * **Up to three published days worth offering for the place** (M27 D13).
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
    ownerDisplayName: string;
    isMine: boolean;
  }[],
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
      author: day.ownerDisplayName,
    }));
}

/**
 * **Freeze the offer for `placeId`**, once the read for it answers. A read for
 * a place the reader has since moved off is dropped: its days are somewhere
 * else. A chosen day the new offer no longer holds cannot be honoured.
 */
export function offerDays(state: NewTripState, placeId: string, offer: readonly PopularDay[]): NewTripState {
  if (state.answers.where?.id !== placeId) return state;
  const offered = new Set(offer.map((day) => day.savedDayId));
  return { ...state, offer, chosen: state.chosen.filter((id) => offered.has(id)) };
}

/** *Start from this*, pressed or pressed again. Only an offered day can be chosen. */
export function toggleDay(state: NewTripState, savedDayId: string): NewTripState {
  if (!state.offer.some((day) => day.savedDayId === savedDayId)) return state;
  const on = state.chosen.includes(savedDayId);
  const chosen = state.offer
    .map((day) => day.savedDayId)
    .filter((id) => (id === savedDayId ? !on : state.chosen.includes(id)));
  return { ...state, chosen };
}

/** The pace options, with what each means for the days. */
export const PACE_OPTIONS: readonly { id: TripPace; label: string; detail: string }[] = [
  { id: "slow", label: "Slow", detail: "Fewer stops, longer lunches" },
  { id: "balanced", label: "Balanced", detail: "A full day with room to breathe" },
  { id: "packed", label: "Packed", detail: "As much as the days will hold" },
];

/**
 * **Cass's line before a page's question**: one clause on the answer before
 * it (SPEC §35.8 — *"never gushing; one clause at most"*), or the opening line
 * on Where. Cass is the picker's voice, with no AI badge (M56 D7).
 */
export function cassLine(state: NewTripState, opening: string): string {
  const { answers } = state;
  if (state.destinationChanged && state.page === 1 && answers.where !== undefined) {
    return `${answers.where.label} now. Your answers are kept — check they still fit.`;
  }
  switch (pageOf(state)) {
    case "where":
      return opening;
    case "start":
      return answers.where === undefined ? "" : `${answers.where.label}, good.`;
    case "length":
      return answers.start === "not-yet" ? "No problem — dates can come later." : "";
    case "pace":
      return "Got it.";
    case "about": {
      const pace = PACE_OPTIONS.find((option) => option.id === answers.pace);
      return pace === undefined ? "" : `${pace.label} it is.`;
    }
    case "review":
      return "Here is the trip. Change anything, then create it — nothing is made until you do.";
  }
}

/**
 * **The line the first page opens with** (SPEC §31.2, §35.8). It says who is
 * asking and the contract §30.2 keeps: nothing is made until the reader says
 * so, so an abandoned sheet costs nothing. First run greets by name when there
 * is one worth using (`firstNameOf`).
 */
export function openingFor(firstRun: boolean, firstName: string | null = null): string {
  if (!firstRun) return "Hi, it’s Cass. Five quick picks and I’ll set the trip up — nothing is made until you say so.";
  const hi = firstName === null ? "Hi, I’m Cass." : `Hi ${firstName}, I’m Cass.`;
  return `${hi} I plan trips here — five quick picks and I’ll set up your first one. Nothing is made until you say so.`;
}

/**
 * **What the answers make, for `createTripWithSetup`.** `arrive` is `""` and
 * the trip undated unless a day was picked; `days` is the length whichever
 * way it was given. The chosen days go with their lengths, so the empty days
 * laid out around them are only the ones they do not fill.
 */
export function setupOf(state: NewTripState): {
  arrive: string;
  days: number | null;
  pace: TripPace | null;
  tags: readonly ActivityTagDescribed[];
  savedDays: readonly PopularDay[];
} {
  const { start, length, pace, about } = state.answers;
  return {
    arrive: start !== undefined && start !== "not-yet" ? (start.iso ?? "") : "",
    days: length?.days ?? null,
    pace: pace ?? null,
    tags: about,
    savedDays: state.offer.filter((day) => state.chosen.includes(day.savedDayId)),
  };
}
