"use client";

import { useCallback, useEffect, useRef, useState, type Ref } from "react";
import Link from "next/link";
import { Check, Lock } from "lucide-react";
import { insertSavedDay, postTurnOutcome, searchPlaces, searchPlaybooks, type ApiResult, type BoardCommand, type CommandOutcome } from "@/lib/apiClient";
import type { PlaceMatch } from "@/lib/cities";
import { displayNameFor, firstNameOf } from "@/lib/displayName";
import { TAG_LABEL } from "@/lib/activityTags";
import { usePreferences } from "@/components/account/PreferencesProvider";
import { useSessionUser } from "@/components/account/useSessionUser";
import { Sheet, type SheetSize } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants, PHONE_TOUCH } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Picker, type PickerAnswer, type PickerOther, type PickerOption } from "@/components/ui/picker";
import { Text } from "@/components/ui/text";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { useAiEntitled } from "@/lib/useAiEntitled";
import type { CarriedAsk, NewTripPrefill } from "@tc/contracts";
import { rememberIntoTrip, type NewTripHandOff } from "@/lib/pendingCarriedAsks";
import { submitOnEnter } from "@/lib/submitOnEnter";
// `…WithYear`: a trip planned eleven months out is the ordinary case here, and
// the board's weekday-first style drops the year (SPEC §32.3).
import { formatTripDateWithYear } from "@/lib/formatDate";
import {
  LENGTH_DAYS,
  LENGTH_MAX,
  LENGTH_MIN,
  NEW_TRIP_PAGES,
  NEW_TRIP_START,
  PACE_OPTIONS,
  REVIEW,
  answer,
  back,
  cassLine,
  changeTo,
  chipFor,
  isAnswered,
  next,
  offerDays,
  openingFor,
  pageOf,
  pickPopularDays,
  setupOf,
  stepLabel,
  toggleDay,
  type NewTripAnswers,
  type NewTripPageId,
  type NewTripPlace,
  type NewTripState,
  type PopularDay,
} from "./newTripScript";
import { DEFAULT_CURRENCY, createTripWithSetup, type SetupLatch, type SetupResult } from "./newTripSubmit";
import { cn } from "@/lib/cn";
import { QUIET_LINK } from "./quietLink";

/**
 * **Moved into the design system** as `PHONE_TOUCH` (M26 link 14) and
 * re-exported here so existing importers keep working.
 */
export const TOUCH = PHONE_TOUCH;

export type NewTripWizardProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * **`tripId` is sent, and an implementation that ignores it silently gives up
   * KI-2026-09-12-e's guarantee.** The wizard mints the id so a retry after a
   * lost response is the same command rather than a second trip. Structural
   * typing cannot make a caller read it; HomeScreen.test.tsx's "creates a first
   * trip from a picked place alone" is what holds it.
   */
  createTrip: (input: { name: string; tripId?: string }) => Promise<ApiResult<{ tripId: string }>>;
  // Awaited, not fire-and-forget (CodeRabbit, PR 32): the setup waits for each
  // command to confirm before navigating. The sequence is `newTripSubmit.ts`'s.
  dispatch: (command: BoardCommand) => Promise<ApiResult<CommandOutcome>>;
  // Called once the trip exists AND every command it needed has confirmed.
  // `navigate` is false only for *create an empty one*, the old single-field
  // dialog's escape hatch, which closed and stayed on the trip list — every
  // e2e spec that makes its trip through `createEmptyTripViaWizard` is built
  // on that (CI, PR 32).
  onCreated?: (tripId: string, opts: { navigate: boolean }) => void;
  /** See `SheetSize`. The caller decides how much of the window this takes. */
  size?: SheetSize;
  /**
   * The sheet's *import a trip file* link (SPEC §35.2). The sheet closes
   * first, so the picker and any refusal must belong to the page, which
   * outlives it. Called synchronously inside the click — see
   * `ImportTripHandle.pick`. Absent, the link is not drawn.
   */
  onImportFile?: () => void;
  /** What a hand-off to New trip already knew (ADR-084 §5): see `KeyedHandOff`. */
  handOff?: KeyedHandOff;
};

/**
 * **A hand-off, numbered by the page that took it.** The pages read a prefill
 * only when they mount, so each hand-off remounts them by its `seq`: one taken
 * while New trip is already open (on a phone the sheet sits under Home's rail)
 * starts page one again with its answers, rather than being dropped.
 */
export type KeyedHandOff = NewTripHandOff & { seq: number };

/** The pages' props for `handOff`. Their `key` is `handOff?.seq`, set beside these. */
export function handOffPagesProps(handOff: KeyedHandOff | undefined): { prefill?: NewTripPrefill; carriedAsks?: readonly CarriedAsk[]; handOffTurnId?: string } {
  return handOff === undefined
    ? {}
    : { prefill: handOff.prefill, carriedAsks: handOff.asks, ...(handOff.turnId === undefined ? {} : { handOffTurnId: handOff.turnId }) };
}

export function NewTripWizard({
  open,
  onOpenChange,
  createTrip,
  dispatch,
  onCreated,
  size = "rail",
  onImportFile,
  handOff,
}: NewTripWizardProps) {
  return (
    // "New trip" on every path: it is the dialog's accessible NAME, what specs
    // address it by, and a surface that renames itself cannot be referred to.
    <Sheet title="New trip" size={size} open={open} onOpenChange={onOpenChange}>
      {/* A fresh mount, and so fresh answers, every time it opens. */}
      {open && (
        <NewTripPages
          key={handOff?.seq}
          {...handOffPagesProps(handOff)}
          createTrip={createTrip}
          dispatch={dispatch}
          onDone={(tripId, navigate) => {
            onOpenChange(false);
            if (tripId !== null) onCreated?.(tripId, { navigate });
          }}
          otherStarts={{
            onStartFromPlaybook: () => onOpenChange(false),
            ...(onImportFile === undefined
              ? {}
              : {
                  onImportFile: () => {
                    onOpenChange(false);
                    onImportFile();
                  },
                }),
          }}
        />
      )}
    </Sheet>
  );
}

/**
 * **Who the first run greets.** A chosen name, else the one the sign-in gave,
 * first word only; never an address and never the "Traveler 4f2a91" handle
 * (`firstNameOf`). Its own hook, called only on first run, so the sheet does
 * not read the session to throw the answer away.
 */
function useFirstName(): string | null {
  const { displayName } = usePreferences();
  const user = useSessionUser();
  if (user === undefined || user === null) return displayName === null ? null : firstNameOf(displayName, "");
  const userId = user.id ?? "";
  return firstNameOf(displayNameFor({ userId, displayName, name: user.name }), displayNameFor({ userId }));
}

/** What a published day's card says under its name (M27 D13: adds, not stars). */
function metaFor(day: PopularDay): string {
  const trips = day.adds === 1 ? "1 trip" : `${day.adds} trips`;
  const days = day.dayCount === 1 ? "1 day" : `${day.dayCount} days`;
  return `Added to ${trips} · ${days} · by ${day.author}`;
}

/** "Tram 28 morning", or "Tram 28 morning and Alfama at dusk", for a sentence. */
function listed(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

const daysText = (n: number) => (n === 1 ? "1 day" : `${n} days`);

/**
 * **What *create an empty one* names a trip with no place picked** (M27 D4).
 * `CreateTrip.name` is `min(1)`, and the trip is renamed from its header.
 */
const UNTITLED_TRIP = "Untitled trip";

/** Each page's question, which is also its control's accessible name. */
const QUESTION: Record<NewTripPageId, string> = {
  where: "Where are you going?",
  start: "Do you have a start date?",
  length: "How long is the trip?",
  pace: "What pace do you want?",
  about: "What is the trip about?",
};

/** Review's row names. */
const TERM: Record<NewTripPageId, string> = {
  where: "Where",
  start: "Start date",
  length: "How long",
  pace: "Pace",
  about: "What it is about",
};

/** What a page's answer reads as on Review and in the subtitle, or `null` while it has none. */
function said(answers: NewTripAnswers, page: NewTripPageId): string | null {
  switch (page) {
    case "where":
      return answers.where?.label ?? null;
    case "start":
      if (answers.start === "not-yet") return "Not yet";
      return answers.start?.iso == null ? null : formatTripDateWithYear(answers.start.iso);
    case "length":
      return answers.length === undefined ? null : (chipFor(answers.length) ?? daysText(answers.length.days));
    case "pace":
      return PACE_OPTIONS.find((option) => option.id === answers.pace)?.label ?? null;
    case "about":
      return answers.about.length === 0 ? null : answers.about.map((tag) => TAG_LABEL[tag]).join(", ");
  }
}

/** *Plan with AI*'s first turn: each answer under Review's name for it. */
function kickoffFor(answers: NewTripAnswers): string {
  const lines = NEW_TRIP_PAGES.flatMap((page) => {
    const value = said(answers, page);
    return value === null ? [] : [`${TERM[page]}: ${value}.`];
  });
  return ["Plan this trip with me.", ...lines].join(" ");
}

/**
 * **A hand-off's answers, on page one** (ADR-084 §5). Length and tags are
 * answers; the place is only Where's search, since a place is a pick.
 */
function prefilled({ days, tags }: NewTripPrefill): NewTripState {
  return {
    ...NEW_TRIP_START,
    answers: {
      about: tags ?? [],
      ...(days === undefined ? {} : { length: { days, other: !Object.values(LENGTH_DAYS).includes(days) } }),
    },
  };
}

/** The progress bar's fill per page: five steps are five fractions, so no inline width. */
const PROGRESS_WIDTH = ["w-1/5", "w-2/5", "w-3/5", "w-4/5", "w-full"] as const satisfies { length: typeof NEW_TRIP_PAGES.length };

const NOT_YET = "not-yet";
const LENGTH_OPTIONS: PickerOption[] = Object.entries(LENGTH_DAYS).map(([chip, days]) => ({
  id: chip,
  label: chip,
  detail: daysText(days),
}));

/**
 * **A page's answer as its `Picker` holds it, and back.** The answers are the
 * one record; the picker's value is derived from them every render, so Review's
 * *Change* reopens a page already showing what was picked.
 */
function pickerValue(page: NewTripPageId, answers: NewTripAnswers): PickerAnswer | null {
  switch (page) {
    case "where":
      return answers.where === undefined
        ? null
        : { optionIds: [], other: { kind: "place", value: { id: answers.where.id, label: answers.where.label } } };
    case "start":
      if (answers.start === undefined) return null;
      return answers.start === NOT_YET
        ? { optionIds: [NOT_YET], other: null }
        : { optionIds: [], other: { kind: "date", value: answers.start.iso } };
    case "length": {
      if (answers.length === undefined) return null;
      const chip = chipFor(answers.length);
      return chip === null
        ? { optionIds: [], other: { kind: "number", value: answers.length.days } }
        : { optionIds: [chip], other: null };
    }
    case "pace":
      return answers.pace === undefined ? null : { optionIds: [answers.pace], other: null };
    case "about":
      return answers.about.length === 0 ? null : { optionIds: [], other: { kind: "tags", value: [...answers.about] } };
  }
}

function answerFrom(page: NewTripPageId, value: PickerAnswer | null): Partial<NewTripAnswers> | null {
  const other = value?.other ?? null;
  switch (page) {
    // Where's answer comes from the search slot itself, which knows the whole place.
    case "where":
      return null;
    case "start":
      if (value === null) return null;
      return other?.kind === "date" ? { start: { iso: other.value } } : { start: NOT_YET };
    case "length": {
      if (other?.kind === "number") return { length: { days: other.value, other: true } };
      const chip = value?.optionIds[0];
      return chip === undefined ? null : { length: { days: LENGTH_DAYS[chip]!, other: false } };
    }
    case "pace": {
      const pace = PACE_OPTIONS.find((option) => option.id === value?.optionIds[0]);
      return pace === undefined ? null : { pace: pace.id };
    }
    case "about":
      return { about: other?.kind === "tags" ? other.value : [] };
  }
}

/** A result's key: two places with one name stay two. */
function placeOf(match: PlaceMatch): NewTripPlace {
  switch (match.kind) {
    case "city":
      return { id: `city:${match.city}`, label: match.city, kind: "city", hasPlaybooks: match.hasPlaybooks };
    case "country":
      return {
        id: `country:${match.countryCode}`,
        label: match.name,
        kind: "country",
        countryCode: match.countryCode,
        hasPlaybooks: match.hasPlaybooks,
      };
    case "world":
      return {
        id: `world:${match.id}`,
        label: match.name,
        detail: match.detail,
        kind: "world",
        ...(match.countryCode === undefined ? {} : { countryCode: match.countryCode }),
        hasPlaybooks: false,
      };
  }
}

type PagesProps = {
  createTrip: NewTripWizardProps["createTrip"];
  dispatch: NewTripWizardProps["dispatch"];
  onDone: (tripId: string | null, navigate: boolean) => void;
  /** Somebody's first trip, which changes Cass's opening line (SPEC §32.1). */
  firstRun?: boolean;
  /**
   * An id for the current page, so a control outside this component can focus
   * it with `focusNewTripPage`: the empty Home's page-head "New trip" button,
   * which would otherwise put a second copy of this flow on one screen.
   */
  pageId?: string;
  /**
   * Holds the controls that write while another trip-start is in flight —
   * Home's `cloningDemo` (CodeRabbit, PR 104). Picking costs nothing and sends
   * nothing, so the pages stay live.
   */
  disabled?: boolean;
  /**
   * **The sheet's other ways in** — *start from a Playbook* and *import a trip
   * file* (§35.2's quiet row). Only the sheet passes them: the first-run card
   * draws both in its own row.
   */
  otherStarts?: {
    /** Runs on the click, alongside the link's own navigation — the sheet closes. */
    onStartFromPlaybook: () => void;
    onImportFile?: () => void;
  };
  prefill?: NewTripPrefill;
  carriedAsks?: readonly CarriedAsk[];
  /** The assistant turn the hand-off came from (M57): named by the trip made from it, and by its chips. */
  handOffTurnId?: string;
};

/** A page's first control a keyboard would reach: the roving radios' unchosen ones are `-1`. */
const FIRST_CONTROL = 'input:not([disabled]), button:not([disabled]):not([tabindex="-1"])';

/**
 * **Focus a page of the flow**: a question page's first control, or Review
 * itself, whose first line says what Review is. Exported for the empty Home's
 * "New trip", which finds the inline flow's page by `pageId`.
 */
export function focusNewTripPage(page: HTMLElement | null) {
  if (page === null) return;
  const first = page.dataset.page === "review" ? null : page.querySelector<HTMLElement>(FIRST_CONTROL);
  (first ?? page).focus();
}

/**
 * Where focus goes after a press that unmounts the button pressed: Review
 * replaces the footer and the page, and a picked result's list goes. Left
 * alone, a keyboard reader lands on the dialog, or on the body in the inline
 * first run, and the next Tab starts from the top.
 */
type Refocus = "page" | "next" | { change: NewTripPageId };

/**
 * **New trip: five pages and a Review** (M56 part 2, ADR-084 §1), with no
 * chrome of its own, so the sheet and the empty Home (`FirstTripStart`) render
 * the one flow.
 */
export function NewTripPages(props: PagesProps) {
  // Two components rather than a conditional hook: only the first run reads
  // the session, and `firstRun` never changes across one mount.
  return props.firstRun === true ? <FirstRunPages {...props} /> : <Pages {...props} firstName={null} />;
}

function FirstRunPages(props: PagesProps) {
  return <Pages {...props} firstName={useFirstName()} />;
}

function Pages({
  createTrip,
  dispatch,
  onDone,
  firstRun = false,
  pageId,
  disabled = false,
  otherStarts,
  firstName,
  prefill,
  carriedAsks = [],
  handOffTurnId,
}: PagesProps & { firstName: string | null }) {
  const [state, setState] = useState<NewTripState>(() => (prefill === undefined ? NEW_TRIP_START : prefilled(prefill)));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // What a previous attempt got through, carried so a retry neither mints a
  // second trip nor re-sends a command that landed (KI-2026-09-08-a).
  const [progress, setProgress] = useState<SetupLatch | null>(null);
  /** Chosen days that could not be put in the trip, by name, once it is made. */
  const [missed, setMissed] = useState<readonly string[] | null>(null);
  // The name the made trip has. A retry after *Change where* has to rename it:
  // with a latch, `createTripWithSetup` skips `CreateTrip`, the one command
  // that otherwise carries the name.
  const [namedAs, setNamedAs] = useState<string | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const refocus = useRef<Refocus | null>(null);
  // Asked from the first page, so it has long resolved by Review. `null`
  // (unknown, or a failed read) takes the paid branch: `useAiEntitled`'s own
  // rule, since a paywall flashed at a subscriber is the worse mistake.
  const aiEntitled = useAiEntitled();

  const page = pageOf(state);
  const { answers } = state;
  const name = answers.where?.label ?? UNTITLED_TRIP;

  // After the commit, so the target is mounted and Next is no longer disabled.
  useEffect(() => {
    const target = refocus.current;
    if (target === null) return;
    refocus.current = null;
    if (target === "page") focusNewTripPage(pageRef.current);
    else if (target === "next") nextRef.current?.focus();
    else pageRef.current?.querySelector<HTMLElement>(`[data-change="${target.change}"]`)?.focus();
  }, [state, missed]);

  /**
   * **The published days for a picked place** (M27 D13, now Review's card,
   * D9). Only a place the library has days for is asked about; what comes
   * back is dropped if the reader has moved on (`offerDays`).
   */
  function lookUp(place: NewTripPlace) {
    if (!place.hasPlaybooks) return;
    const query =
      place.kind === "country" && place.countryCode !== undefined
        ? { countries: [place.countryCode] }
        : { cities: [place.label] };
    void searchPlaybooks({ ...query, sort: "most-added" }).then((result) => {
      if (result.ok) setState((current) => offerDays(current, place.id, pickPopularDays(result.value.days)));
    });
  }

  /** `fromList` when a result was pressed; Enter leaves focus in the field, which stays. */
  function pickPlace(place: NewTripPlace, fromList: boolean) {
    if (place.id === answers.where?.id) {
      // Nothing changes, so the effect does not run; Next is already live.
      if (fromList) nextRef.current?.focus();
      return;
    }
    if (fromList) refocus.current = "next";
    setState((current) => answer(current, { where: place }));
    lookUp(place);
  }

  function goNext() {
    const to = next(state);
    if (to === state) return;
    // Every move refocuses: a question page opens unanswered, so its Next
    // would render disabled under the focus that pressed it.
    refocus.current = page !== "review" && state.fromReview && to.page === REVIEW ? { change: page } : "page";
    setState(to);
  }

  function goBack() {
    // Page one has no Back button.
    if (state.page === 1) refocus.current = "page";
    setState(back);
  }

  /** Make the trip and apply what was answered. `null` when nothing was made. */
  async function run(applySetup: boolean): Promise<Extract<SetupResult, { ok: true }> | null> {
    if (submitting || disabled) return null;
    setError(null);
    setSubmitting(true);
    if (progress !== null && namedAs !== null && namedAs !== name) {
      const renamed = await dispatch({ type: "SetTripName", tripId: progress.tripId, name });
      if (!renamed.ok) {
        setSubmitting(false);
        setError(`Trip created, but renaming it failed: ${renamed.error.message}. Try again.`);
        return null;
      }
      setNamedAs(name);
    }
    const result = await createTripWithSetup({
      setup: {
        name,
        ...setupOf(state),
        // No budget or currency page; the branches stay in `newTripSubmit.ts`,
        // tested there, for whichever plan brings the fields back.
        budget: null,
        currency: DEFAULT_CURRENCY,
      },
      applySetup,
      latch: progress,
      createTrip,
      dispatch,
      insertDay: insertSavedDay,
    });
    // Stored on BOTH outcomes: dropping the latch on failure is the defect
    // `newTripSubmit.ts`'s own header describes.
    if (result.latch !== null) setProgress(result.latch);
    if (result.latch !== null && progress === null) setNamedAs(name);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return null;
    }
    return result;
  }

  /**
   * **Create, and go to the trip.** *Plan with AI* also leaves the trip a
   * kickoff, which its board sends with the rail open (M56 D1): written here
   * from the answers, not by the model, so the first turn says what was picked.
   * Carried asks ride either way, as chips, and with `createEmpty` too.
   *
   * A chosen day that did not land keeps the sheet up long enough to say
   * which — navigating past the only place that says it would lose it.
   */
  async function create(planWithAi: boolean) {
    const result = await run(true);
    if (result === null) return;
    const kickoff = planWithAi ? kickoffFor(answers) : null;
    void postTurnOutcome(handOffTurnId, "trip_created_from_hand_off");
    if (kickoff !== null || carriedAsks.length > 0) {
      rememberIntoTrip(result.latch.tripId, { kickoff, asks: [...carriedAsks], ...(handOffTurnId === undefined ? {} : { turnId: handOffTurnId }) });
    }
    if (result.missedDays.length > 0) {
      // Open the trip replaces the pressed button; the page holds the line
      // that says which day failed.
      refocus.current = "page";
      setMissed(setupOf(state).savedDays.filter((day) => result.missedDays.includes(day.savedDayId)).map((day) => day.name));
      return;
    }
    onDone(result.latch.tripId, true);
  }

  /** No kickoff, but a hand-off's carried asks still become the trip's chips (M56 D5). */
  async function createEmpty() {
    const result = await run(false);
    if (result === null) return;
    void postTurnOutcome(handOffTurnId, "trip_created_from_hand_off");
    if (carriedAsks.length > 0) {
      rememberIntoTrip(result.latch.tripId, { kickoff: null, asks: [...carriedAsks], ...(handOffTurnId === undefined ? {} : { turnId: handOffTurnId }) });
    }
    onDone(result.latch.tripId, false);
  }

  const step = stepLabel(state);
  const decided = NEW_TRIP_PAGES.flatMap((each) => said(answers, each) ?? []);

  return (
    // `h-full` so this column takes the sheet scrollport's height and the body
    // below, not the sheet, is what scrolls: the footer stays at the foot
    // (§31.3, the `5c27d37` preview defect).
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex shrink-0 flex-col gap-1.5">
        {step !== null && (
          <>
            <div
              role="progressbar"
              aria-label="New trip progress"
              aria-valuemin={1}
              aria-valuemax={NEW_TRIP_PAGES.length}
              aria-valuenow={state.page + 1}
              aria-valuetext={step}
              className="h-1.5 overflow-hidden rounded-full bg-moss"
            >
              <div className={cn("h-full rounded-full bg-brand transition-[width]", PROGRESS_WIDTH[state.page])} />
            </div>
            <Text variant="secondary" className="text-xs font-semibold">
              {step}
            </Text>
          </>
        )}
        {decided.length > 0 && (
          <Text variant="secondary" className="text-pretty" data-testid="new-trip-decided">
            {decided.join(" · ")}
          </Text>
        )}
      </div>

      {/* Keyed by page so each one is a fresh mount, which `[data-step-enter]`
          fades in (M54). Focusable only from code (`focusNewTripPage`). */}
      <div
        key={state.page}
        ref={pageRef}
        tabIndex={-1}
        {...(pageId === undefined ? {} : { id: pageId })}
        data-page={page}
        data-step-enter
        data-testid="new-trip-page"
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain focus:outline-none"
      >
        {state.destinationChanged && page !== "review" && page !== "where" && (
          <Badge variant="warning" className="self-start">
            Destination changed
          </Badge>
        )}
        {missed === null && <Text className="text-pretty">{cassLine(state, openingFor(firstRun, firstName))}</Text>}
        {page === "review" ? (
          <Review
            state={state}
            missed={missed}
            onChange={(each) => {
              refocus.current = "page";
              setState((current) => changeTo(current, each));
            }}
            onToggleDay={(id) => setState((current) => toggleDay(current, id))}
          />
        ) : (
          <PagePicker
            page={page}
            answers={answers}
            whereQuery={prefill?.place}
            onPlace={pickPlace}
            onAnswer={(patch) => setState((current) => answer(current, patch))}
          />
        )}
      </div>

      <div className="flex shrink-0 flex-col gap-2.5 border-t border-hairline pt-3">
        {error !== null && (
          <Text as="p" role="alert" className="text-danger-ink">
            {error}
          </Text>
        )}
        {page === "review" ? (
          <ReviewActions
            aiEntitled={aiEntitled}
            made={missed !== null}
            busy={disabled || submitting}
            onCreate={(planWithAi) => void create(planWithAi)}
            onOpen={() => onDone(progress?.tripId ?? null, true)}
          />
        ) : (
          <PageActions state={state} nextRef={nextRef} onBack={goBack} onNext={goNext} />
        )}
        {/* **The rare ways in, as one quiet row** (SPEC §35.2). Not on Review,
            which has the real create buttons. */}
        {page !== "review" && (
          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 px-0.5 text-xs text-slate">
            <span>Or</span>
            {otherStarts !== undefined && (
              <>
                <Link
                  href="/playbooks"
                  onClick={otherStarts.onStartFromPlaybook}
                  className={cn(buttonVariants({ variant: "ghost" }), QUIET_LINK, "text-ink")}
                >
                  start from a Playbook
                </Link>
                {otherStarts.onImportFile !== undefined && (
                  <Button
                    type="button"
                    variant="ghost"
                    className={cn(QUIET_LINK, "text-ink")}
                    disabled={disabled || submitting}
                    onClick={otherStarts.onImportFile}
                  >
                    import a trip file
                  </Button>
                )}
              </>
            )}
            <Button
              type="button"
              variant="ghost"
              className={cn(QUIET_LINK, "text-ink")}
              disabled={disabled || submitting}
              onClick={() => void createEmpty()}
            >
              create an empty one
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/** One page's question, as the boxed picker (part 1's `Picker`). */
function PagePicker({
  page,
  answers,
  whereQuery,
  onPlace,
  onAnswer,
}: {
  page: NewTripPageId;
  answers: NewTripAnswers;
  /** A hand-off's place, searched for until one is picked. */
  whereQuery: string | undefined;
  onPlace: (place: NewTripPlace, fromList: boolean) => void;
  onAnswer: (patch: Partial<NewTripAnswers>) => void;
}) {
  const options: PickerOption[] =
    page === "start"
      ? [{ id: NOT_YET, label: "Not yet" }]
      : page === "length"
        ? LENGTH_OPTIONS
        : page === "pace"
          ? PACE_OPTIONS.map(({ id, label, detail }) => ({ id, label, detail }))
          : [];
  const other: PickerOther | undefined =
    page === "where"
      ? {
          kind: "place",
          label: QUESTION.where,
          slot: ({ labelledBy }) => (
            <WhereSearch
              labelledBy={labelledBy}
              picked={answers.where}
              initialQuery={answers.where === undefined ? (whereQuery ?? "") : ""}
              onPick={onPlace}
            />
          ),
        }
      : page === "start"
        ? { kind: "date", label: "Yes, pick a day" }
        : page === "length"
          ? { kind: "number", label: "Another length", min: LENGTH_MIN, max: LENGTH_MAX, initial: 7, unit: { one: "day", many: "days" } }
          : page === "about"
            ? { kind: "tags", label: QUESTION.about }
            : undefined;
  return (
    <Picker
      question={QUESTION[page]}
      options={options}
      {...(other === undefined ? {} : { other })}
      value={pickerValue(page, answers)}
      onChange={(value) => {
        const patch = answerFrom(page, value);
        if (patch !== null) onAnswer(patch);
      }}
    />
  );
}

/** Back and Next; Next waits for an answer, and a page Review opened goes back to it. */
function PageActions({
  state,
  nextRef,
  onBack,
  onNext,
}: {
  state: NewTripState;
  nextRef: Ref<HTMLButtonElement>;
  onBack: () => void;
  onNext: () => void;
}) {
  const page = pageOf(state);
  if (page === "review") return null;
  const rewalk = page === "where" && state.answers.where?.id !== state.leftWhere?.id;
  const label = state.fromReview && !rewalk ? "Back to review" : state.page === REVIEW - 1 ? "Review" : "Next";
  return (
    <div className="flex items-center justify-end gap-2">
      {state.page > 0 && !state.fromReview && (
        <Button type="button" variant="secondary" className={TOUCH} onClick={onBack}>
          Back
        </Button>
      )}
      <Button
        ref={nextRef}
        type="button"
        variant="primary"
        className={TOUCH}
        disabled={!isAnswered(state.answers, page)}
        onClick={onNext}
      >
        {label}
      </Button>
    </div>
  );
}

/**
 * **Review: every answer with its *Change*, and the optional published days**
 * (D9). Nothing here is required: skipping the days changes nothing.
 */
function Review({
  state,
  missed,
  onChange,
  onToggleDay,
}: {
  state: NewTripState;
  missed: readonly string[] | null;
  onChange: (page: NewTripPageId) => void;
  onToggleDay: (savedDayId: string) => void;
}) {
  const { answers } = state;
  if (missed !== null) {
    const placed = setupOf(state).savedDays.map((day) => day.name).filter((each) => !missed.includes(each));
    return (
      <Text className="text-pretty">
        {`Done. ${answers.where?.label ?? UNTITLED_TRIP} is created.`}
        {placed.length > 0 && ` ${listed(placed)} ${placed.length === 1 ? "is" : "are"} already in place.`}
        {` ${listed(missed)} could not be added — ${missed.length === 1 ? "it is" : "they are"} still in Playbooks.`}
      </Text>
    );
  }
  return (
    <>
      <dl className="flex flex-col divide-y divide-hairline rounded-lg border border-hairline bg-surface">
        {NEW_TRIP_PAGES.map((each) => (
          <div key={each} className="flex items-center gap-3 px-3 py-2">
            <div className="flex min-w-0 flex-1 flex-col">
              <dt className="text-xs font-semibold text-slate">{TERM[each]}</dt>
              <dd className="text-base text-ink">{said(answers, each) ?? (each === "about" ? "Anything" : "—")}</dd>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={TOUCH}
              aria-label={`Change ${TERM[each].toLowerCase()}`}
              data-change={each}
              onClick={() => onChange(each)}
            >
              Change
            </Button>
          </div>
        ))}
      </dl>
      {state.offer.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <Text className="font-semibold">Start from a published day</Text>
          <Text variant="secondary" className="text-pretty">
            {`People planning ${answers.where?.label ?? "there"} keep adding ${state.offer.length === 1 ? "this day" : "these days"}. Optional — skip it and nothing changes.`}
          </Text>
          <div role="group" aria-label="Popular days" className="flex flex-col gap-1.5">
            {state.offer.map((day) => {
              const on = state.chosen.includes(day.savedDayId);
              return (
                <ToggleChip
                  key={day.savedDayId}
                  pressed={on}
                  onClick={() => onToggleDay(day.savedDayId)}
                  className={`flex-row items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-ink ${
                    on ? "" : "border-hairline hover:border-border-strong"
                  }`}
                >
                  <span className="flex min-w-0 flex-auto flex-col gap-0.5">
                    <span className="text-base font-semibold">{day.name}</span>
                    <span className="text-a-note text-pretty text-slate">{metaFor(day)}</span>
                  </span>
                  <span className={`shrink-0 text-a-note font-semibold ${on ? "text-brand-pressed" : "text-brand"}`}>
                    {on ? "✓ Starting from this" : "Start from this"}
                  </span>
                </ToggleChip>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

/**
 * **Review's buttons split on what the account HOLDS, never on a plan name**
 * (ADR-045 rule 4; `planVersions.fourthPlan.test.ts` greps for that
 * comparison). Free: *Create trip* and one quiet locked line. Paid, or not
 * known yet: *Just create it* and *Plan with AI*.
 */
function ReviewActions({
  aiEntitled,
  made,
  busy,
  onCreate,
  onOpen,
}: {
  aiEntitled: boolean | null;
  made: boolean;
  busy: boolean;
  /** `true` is *Plan with AI*. */
  onCreate: (planWithAi: boolean) => void;
  onOpen: () => void;
}) {
  if (made) {
    return (
      <div className="flex justify-end">
        <Button type="button" variant="primary" className={TOUCH} onClick={onOpen}>
          Open the trip
        </Button>
      </div>
    );
  }
  if (aiEntitled === false) {
    return (
      <div className="flex flex-col items-end gap-2">
        <Button type="button" variant="primary" className={TOUCH} disabled={busy} onClick={() => onCreate(false)}>
          Create trip
        </Button>
        {/* "No teaser, no disabled input" (§30.3): a line and a link, never a
            greyed-out button. */}
        <Text variant="secondary" className="flex items-center gap-1.5 text-xs">
          <Lock className="size-3.5 shrink-0" aria-hidden />
          Planning it with AI is part of Plus.
          <Link href="/plans" className={cn(buttonVariants({ variant: "ghost" }), QUIET_LINK, "text-ink")}>
            See plans
          </Link>
        </Text>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" className={TOUCH} disabled={busy} onClick={() => onCreate(false)}>
          Just create it
        </Button>
        <Button type="button" variant="primary" className={TOUCH} disabled={busy} onClick={() => onCreate(true)}>
          Plan with AI
        </Button>
      </div>
    </div>
  );
}

/** ~250ms, as Discover's place search waits (`PlaceSearch`). */
const DEBOUNCE_MS = 250;

type SearchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "results"; q: string; places: NewTripPlace[] }
  | { kind: "empty" }
  | { kind: "failed" };

/**
 * **Where's search: only a result is an answer** (ADR-084 §7). What is typed
 * finds places and is never itself one; Enter takes the first result, as
 * every search box here does. Asks with `world=1` (M56 D3), so a signed-in
 * reader also gets places outside the library, after it.
 *
 * Its own box rather than Discover's `PlaceSearch`: that one adds and removes
 * filter chips, and this commits one place.
 */
function WhereSearch({
  labelledBy,
  picked,
  initialQuery,
  onPick,
}: {
  labelledBy: string;
  picked: NewTripPlace | undefined;
  initialQuery: string;
  onPick: (place: NewTripPlace, fromList: boolean) => void;
}) {
  const [text, setText] = useState(initialQuery);
  const [state, setState] = useState<SearchState>({ kind: "idle" });
  // Keystrokes race: without this the slower of two searches wins.
  const generation = useRef(0);

  const run = useCallback(async (q: string) => {
    const mine = ++generation.current;
    if (q.trim() === "") {
      setState({ kind: "idle" });
      return;
    }
    setState({ kind: "loading" });
    const result = await searchPlaces(q, { world: true });
    if (mine !== generation.current) return;
    if (!result.ok) {
      setState({ kind: "failed" });
      return;
    }
    const places = result.value.map(placeOf);
    setState(places.length === 0 ? { kind: "empty" } : { kind: "results", q, places });
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void run(text), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, run]);

  const pick = (place: NewTripPlace, fromList: boolean) => {
    onPick(place, fromList);
    setText("");
  };

  return (
    <div className="flex flex-col gap-2">
      {picked !== undefined && (
        <Text className="flex items-center gap-1.5 font-semibold text-brand-pressed">
          <Check className="size-4 shrink-0" aria-hidden />
          {picked.label}
          {picked.detail !== undefined && <span className="font-normal text-slate">{picked.detail}</span>}
        </Text>
      )}
      <Input
        type="search"
        aria-labelledby={labelledBy}
        placeholder={picked === undefined ? "Search a city or country" : "Search for somewhere else"}
        className={TOUCH}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={submitOnEnter(() => {
          // Only results for the text in the box: mid-debounce the list is the
          // previous query's.
          if (state.kind === "results" && state.q === text && state.places[0] !== undefined) pick(state.places[0], false);
        })}
      />
      {/* The status is announced and the list is not: a live region round the
          list read every result's label out on every keystroke. */}
      <div className="flex items-center gap-2">
        <div aria-live="polite">
          {state.kind === "loading" && <Text variant="muted">Searching places…</Text>}
          {state.kind === "empty" && <Text variant="muted">{`No place matches “${text}”.`}</Text>}
          {state.kind === "failed" && <Text variant="muted">Place search is unavailable.</Text>}
          {state.kind === "results" && (
            <span className="sr-only">{state.places.length === 1 ? "1 place" : `${state.places.length} places`}</span>
          )}
        </div>
        {state.kind === "failed" && (
          <Button type="button" variant="secondary" size="sm" onClick={() => void run(text)}>
            Retry
          </Button>
        )}
      </div>
      {state.kind === "results" && (
        <div role="group" aria-label="Places" className="flex flex-col gap-1.5">
          {state.places.map((place) => (
            <Button
              key={place.id}
              type="button"
              variant="secondary"
              className={cn(TOUCH, "h-auto justify-start gap-2 py-1.5 text-left")}
              // The region says which of two same-named places it is, and
              // *has Playbooks* is spoken as well as shown (WCAG 2.5.3).
              aria-label={[place.label, place.detail, place.hasPlaybooks ? "has Playbooks" : undefined]
                .filter((part) => part !== undefined)
                .join(", ")}
              onClick={() => pick(place, true)}
            >
              <span className="font-semibold">{place.label}</span>
              {place.detail !== undefined && <span className="text-slate">{place.detail}</span>}
              {place.hasPlaybooks && <span className="text-xs text-slate">has Playbooks</span>}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
