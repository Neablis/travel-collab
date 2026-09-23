"use client";

import { useEffect, useRef, useState } from "react";
import {
  insertSavedDay,
  searchPlaybooks,
  type ApiResult,
  type BoardCommand,
  type CommandOutcome,
} from "@/lib/apiClient";
import { displayNameFor } from "@/lib/displayName";
import { usePreferences } from "@/components/account/PreferencesProvider";
import { useSessionUser } from "@/components/account/useSessionUser";
import { Sheet, type SheetSize } from "@/components/ui/sheet";
import { DialogFooter } from "@/components/ui/dialog";
import Link from "next/link";
import { Button, buttonVariants, PHONE_TOUCH } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Preview } from "@/components/ui/preview";
import { Text } from "@/components/ui/text";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { Transcript, type AssistantTurn } from "@/components/assistant/Transcript";
import { usePinToBottom } from "@/components/assistant/usePinToBottom";
import { useAiEntitled } from "@/components/assistant/useAiEntitled";
import { submitOnEnter } from "@/lib/submitOnEnter";
// `…WithYear`, not `formatTripDate`: §32.3's own example of "the app's own
// style" is `Apr 10, 2027`, and a trip being planned eleven months out is the
// ordinary case here. The weekday-first variant the board uses drops the year,
// which reads fine on a day inside an open trip and badly as the answer to
// "when do you arrive".
import { formatTripDateWithYear } from "@/lib/formatDate";
import {
  CASS_DRAFTING_LINE,
  CASS_DRAFTING_MS,
  CASS_TYPING_MS,
  daysFor,
  NEW_TRIP_START,
  changeTo,
  cityOf,
  commitAnswer,
  commitMulti,
  firstNameOf,
  offerDays,
  openingFor,
  pickPopularDays,
  questionAt,
  questionsOf,
  spokenAsk,
  togglePick,
  type NewTripState,
  type PopularDay,
} from "./newTripScript";
import {
  DEFAULT_CURRENCY,
  ISO_DATE,
  createTripWithSetup,
  type SetupLatch,
  type SetupResult,
} from "./newTripSubmit";
import { cn } from "@/lib/cn";
import { QUIET_LINK } from "./quietLink";
import { AnswerPill } from "./AnswerPill";

/**
 * **44px on a phone, this app's own size on a pointer** (SPEC §32.2, §13.1).
 *
 * §32.2 draws the new-trip dock with 44px inputs and 40px chips; §13.1 is the
 * standing rule the design system already enforces — *"44px targets, always"*.
 * This build is one responsive surface rather than the handoff's two frames, so
 * the floor is applied at phone width and released above it, leaving the
 * desktop dock exactly as §31 left it. `min-h`, not `h`, because a wrapped
 * label on a 390px screen must push the control taller rather than spill out of
 * it — and because `min-height` beats the variants' fixed `h-*` without having
 * to restate it.
 *
 * The 40px chip is deliberately not built: it would be a sixth control height
 * in a scale that has four, to sit 4px under a floor §13.1 says is absolute.
 */
/**
 * **Moved into the design system** as `PHONE_TOUCH` (M26 link 14) and re-exported
 * here so existing importers keep working. It was defined in this wizard and
 * imported by anything that needed a phone floor, which is the wrong owner for
 * a rule from SPEC §13.1 — and it released at `sm`, leaving 640–767px without a
 * floor while every other phone rule in this app draws the line at 767.
 */
export const TOUCH = PHONE_TOUCH;

export type NewTripWizardProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * **`tripId` is sent, and an implementation that ignores it silently gives up
   * KI-2026-09-12-e's guarantee.** The wizard mints the id so a retry after a
   * lost response is the same command rather than a second trip.
   *
   * Declaring it here is documentation, not enforcement: structural typing
   * accepts a narrower `(input: { name: string }) => …` by contravariance, so
   * the compiler cannot make a caller read the property. This type said
   * `{ name: string }` for a while after the id started being sent, which is
   * exactly the gap worth closing — an implementer had no way to know.
   *
   * What actually holds the guarantee is a test, not a type: page.test.tsx's
   * "creates a first trip from a name alone" asserts the real request body
   * carries a uuid, through the real `createTrip` and a mocked `fetch`.
   */
  createTrip: (input: { name: string; tripId?: string }) => Promise<ApiResult<{ tripId: string }>>;
  // Awaited, not fire-and-forget (CodeRabbit, PR #32): the setup sequence waits
  // for each dispatched command to confirm — or report a real failure — before
  // navigating, rather than racing an in-flight SetTripDates against the trip
  // page's own first load. The sequence itself lives in `newTripSubmit.ts`.
  dispatch: (command: BoardCommand) => Promise<ApiResult<CommandOutcome>>;
  // Called once the trip exists AND every dispatched command it needed has
  // confirmed. `navigate` is true only for the paths that finish the
  // conversation — "create an empty one" is the old single-field dialog's
  // escape hatch, and that dialog never navigated: it closed and left the user
  // on the trip list to open the new trip themselves. Every pre-Phase-7 e2e
  // spec is built on that, and a version of this that always navigated broke
  // every one of them (CI, PR #32) by leaving the home page before the click
  // ever ran.
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
};

export function NewTripWizard({
  open,
  onOpenChange,
  createTrip,
  dispatch,
  onCreated,
  size = "rail",
  onImportFile,
}: NewTripWizardProps) {
  return (
    // The title stays "New trip" on both paths. It is the dialog's accessible
    // NAME — what a screen reader announces and what tests and specs address it
    // by — and a surface that renames itself depending on how many trips you
    // have is one that cannot be referred to. The first-run framing goes in the
    // body instead, where it is copy rather than identity.
    <Sheet title="New trip" size={size} open={open} onOpenChange={onOpenChange}>
      {/* Mirrors ActivityEditorSheet's `{open && (...)}` guard: forces a
          fresh mount (and so fresh local state) every time the wizard is
          reopened, rather than reusing whatever was left over from a
          previous open/cancel. */}
      {open && (
        <NewTripConversation
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
 * **The turns, as a transcript.**
 *
 * Each asked question is an assistant turn and each answer is a user turn, so
 * the same `Transcript` the assistant rail uses renders this. It is a third
 * consumer of that component rather than a fourth implementation of one.
 *
 * `tools: []` on every assistant turn, and `pending: false` on every one but
 * the typing row. SPEC §30.2 — the turns make **zero model calls** — still
 * holds; what §35.8 changed (M27 D14) is that Cass takes a visible beat after
 * each answer. **Everything after the reader's last answer waits behind that
 * row**: the acknowledgement and the next question arrive together when it
 * ends, which is what makes it read as a reply rather than as a form that
 * happens to animate.
 *
 * The list comes from `questionsOf(state)` rather than a constant, because
 * §32.3's flow grows by the day picker and §35.8's by the Playbook-day turn,
 * and a thread built from a stale list would print a question the reader is
 * no longer being asked.
 */
function threadFor(
  state: NewTripState,
  closing: string | null,
  opening: string,
  typing: "answer" | "draft" | null,
): AssistantTurn[] {
  const turns: AssistantTurn[] = [
    // **§31.2 — one line before any question.** It states §30.2's contract in
    // the reader's own reading order, and it means turn one is never an empty
    // pane with a dock under it.
    { id: "opening", role: "assistant", text: opening, tools: [], pending: false },
  ];
  questionsOf(state).forEach((question, index) => {
    if (index > state.turn) return;
    turns.push({
      id: `ask-${question.id}`,
      role: "assistant",
      text: spokenAsk(state, index),
      tools: [],
      pending: false,
    });
    const answer = state.answers[question.id];
    if (answer !== undefined && index < state.turn) {
      turns.push({ id: `said-${question.id}`, role: "user", text: answer });
    }
  });
  if (closing !== null) {
    turns.push({ id: "made", role: "assistant", text: closing, tools: [], pending: false });
  }
  if (typing === null) return turns;
  const lastAnswer = turns.map((turn) => turn.role).lastIndexOf("user");
  return [
    ...turns.slice(0, lastAnswer + 1),
    {
      id: "typing",
      role: "assistant",
      text: typing === "draft" ? CASS_DRAFTING_LINE : "",
      tools: [],
      pending: true,
    },
  ];
}

/**
 * **Who the first run greets.** A chosen name, else the one the sign-in gave,
 * first word only; never an address and never the "Traveler 4f2a91" handle
 * the app invents when it has neither (`firstNameOf`).
 *
 * A hook of its own, called only on first run, so the sheet — which opens
 * without a name — does not read the session to throw the answer away.
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

/**
 * **The conversation itself, with no chrome of its own.**
 *
 * Exported because two surfaces render it: this file's `Sheet`, and
 * `FirstTripStart` on a Home with no trips. Before this it was private and the
 * empty Home instead described the questions in a numbered list beside a button
 * that opened the sheet — a second, drifting account of the same script (it had
 * already gone stale once, promising a "Who & money" step the flow does not
 * have). One conversation, rendered in both places, cannot drift from itself.
 */
/**
 * **The free half of §30.3's fork.** The trip is made and it is theirs; what is
 * behind Plus is *changing it by asking*.
 *
 * Three things §30.3 asks for by name, and one it forbids:
 *
 * - *"the trip is finished and yours to edit"* — said first, because the fear a
 *   paywall at the end of a flow creates is that the work was for nothing.
 * - *"changing it by asking is part of Plus"* — the capability, stated plainly,
 *   not a plan name and not a list of features.
 * - *"A See plans button beside it goes to the plans route"* (§29).
 * - **"No teaser, no disabled input."** The composer is not rendered at all in
 *   the `made` phase, for either branch — which is the shape this build already
 *   had, and is why nothing here disables anything.
 *
 * A `Link`, not a `Button` with a router push: a navigation a reader can
 * middle-click, copy, or open in a new tab, and that assistive technology reads
 * as a link.
 */
function NewTripPlusNote() {
  return (
    <div className="mt-4 flex flex-col items-start gap-2 rounded-lg border border-hairline bg-moss p-3.5">
      <Text variant="secondary" className="text-pretty">
        Your trip is finished and yours to edit. Changing it by asking — telling the assistant what
        to move and having it redrawn — is part of Plus.
      </Text>
      <Link
        href="/plans"
        className={`${buttonVariants({ variant: "secondary", size: "sm" })} no-underline`}
      >
        See plans
      </Link>
    </div>
  );
}

/**
 * **What *create an empty one* names a trip nobody named** (M27 D4). The link
 * is live from turn one, before anything is typed, and `CreateTrip.name` is
 * `min(1)` — the domain refuses a nameless trip. Loosening that would be a
 * contract change to save one word, and it is renamed from the trip header.
 */
const UNTITLED_TRIP = "Untitled trip";

type ConversationProps = {
  createTrip: NewTripWizardProps["createTrip"];
  dispatch: NewTripWizardProps["dispatch"];
  onDone: (tripId: string | null, navigate: boolean) => void;
  /**
   * Somebody's first trip, which changes the line the thread opens with (SPEC
   * §32.1, §35.8) — "I'll draft the trip" has no antecedent on a screen with
   * no trips behind it — and the answer pills' size, which is the page's
   * rather than the sheet's (§35.9).
   */
  firstRun?: boolean;
  /**
   * An id for the answer field, so a control outside this component can focus
   * it. The empty Home's page-head "New trip" button uses it: with the
   * conversation already on the page, opening a second copy in a sheet would
   * put two composers with the same accessible name on one screen.
   */
  composerId?: string;
  /**
   * Blocks the exits while another trip-start is already in flight — Home's
   * `cloningDemo`. The first-run screen can be on display at that exact moment
   * (an empty list is what both "no trips yet" and "the clone has not resolved
   * yet" look like), and creating here would race the same `duplicateTrip` the
   * page head's button is already guarded against (CodeRabbit, PR #104).
   *
   * The QUESTIONS stay live: answering them costs nothing and sends nothing
   * (§30.2), so freezing the conversation would be theatre. Only the two
   * controls that write are held.
   */
  disabled?: boolean;
  /**
   * **The sheet's other ways in** — *start from a Playbook* and *import a trip
   * file* in §35.2's quiet row. Only the sheet passes them: the first-run card
   * already draws both routes in its own row, and a second row of the same
   * links one block above it would be the duplicate §35 exists to remove. So
   * on first run the row is *Or create an empty one* alone — which has to stay,
   * because it is the only way to a trip with no answers at all.
   */
  otherStarts?: {
    /** Runs on the click, alongside the link's own navigation — the sheet closes. */
    onStartFromPlaybook: () => void;
    onImportFile?: () => void;
  };
};

export function NewTripConversation(props: ConversationProps) {
  // Two components rather than a conditional hook: only the first run reads
  // the session, and `firstRun` never changes across one mount.
  return props.firstRun === true ? <FirstRunConversation {...props} /> : <Conversation {...props} firstName={null} />;
}

function FirstRunConversation(props: ConversationProps) {
  return <Conversation {...props} firstName={useFirstName()} />;
}

function Conversation({
  createTrip,
  dispatch,
  onDone,
  firstRun = false,
  composerId,
  disabled = false,
  otherStarts,
  firstName,
}: ConversationProps & { firstName: string | null }) {
  const [state, setState] = useState<NewTripState>(NEW_TRIP_START);
  const [phase, setPhase] = useState<"asking" | "made">("asking");
  /**
   * **Cass is "typing"** (SPEC §35.8, M27 D14): `answer` for the beat after
   * each committed answer, `draft` for the longer one before the trip is made.
   * While it is set, the thread ends at the reader's last answer and the dock
   * is hidden — there is nothing to answer until the next line has arrived.
   */
  const [typing, setTyping] = useState<"answer" | "draft" | null>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endTyping = useRef<(() => void) | null>(null);
  const dockRef = useRef<HTMLDivElement | null>(null);
  const refocus = useRef(false);
  /**
   * **The Playbook-day read for the last `where` answer** (M27 D13). A ref,
   * not state: nothing renders from it. The typing row's end reads whatever it
   * holds at that moment and freezes it into the script with `offerDays` —
   * found, failed, or still in flight all come out as "offer these" or "offer
   * nothing", and the script never waits on the network for longer than the
   * row it was going to show anyway.
   */
  const pbRead = useRef<{ token: number; days: PopularDay[] }>({ token: 0, days: [] });
  /** Chosen days that could not be put into the trip, by name, for the closing line. */
  const [missed, setMissed] = useState<readonly string[]>([]);
  // The timer outlives nothing: an unmounted conversation has no row to end.
  useEffect(
    () => () => {
      if (typingTimer.current !== null) clearTimeout(typingTimer.current);
      pbRead.current = { token: pbRead.current.token + 1, days: [] };
    },
    [],
  );
  const [draft, setDraft] = useState("");
  /**
   * **The ISO behind the arrival answer**, and only ever set by the day picker.
   *
   * §32.3 replaced the old arrive→leave range with one picked day, so this is
   * now a single value rather than two ends and a computed span. It is cleared
   * whenever the `start` answer is replaced by prose or dropped by revising the
   * date question, because an answer that says "early April" must not still be
   * dating the trip to a day the reader picked and then removed.
   */
  const [arrive, setArrive] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // What a previous attempt got through. Carried across attempts so a retry
  // neither mints a second trip nor re-sends a command that already landed —
  // KI-2026-09-08-a, and the reason `newTripSubmit.ts` returns this on failure
  // as well as on success.
  const [progress, setProgress] = useState<SetupLatch | null>(null);

  // **This column is the scrollport, so pinning belongs here** rather than
  // inside `Transcript`, which owns none. `scrollTop`, never `scrollIntoView`:
  // SPEC §30.6 bans it repo-wide because it moves every scrollable ancestor,
  // and KI-2026-09-13-a is an open bug in that family.
  const threadRef = useRef<HTMLDivElement | null>(null);
  // `typing` too: the thread pins to the newest line AFTER the row resolves
  // (§35.8), which is when the acknowledgement and the question arrive.
  usePinToBottom(threadRef, [state.turn, phase, typing]);

  const questions = questionsOf(state);
  const question = questionAt(state);
  const where = state.answers.where;
  // The trip's name is the destination answer, or whatever is in the composer
  // before it has been committed — which is what preserves "type a name, press
  // create an empty one" exactly as the old single-field dialog worked.
  //
  // **While `where` is the live question, the composer wins** (CodeRabbit, PR
  // #188). `changeTo` keeps the answers rather than clearing them, so pressing
  // Change back to turn one leaves the OLD destination committed; typing a new
  // one and pressing Create empty then made a trip named the thing on screen a
  // moment ago, not the thing in the field. An uncommitted edit to the question
  // being asked is the more recent intent. `UNTITLED_TRIP` covers the one
  // path that may have neither.
  const composing = question?.id === "where" && draft.trim() !== "";
  const name = (composing ? draft : (where ?? draft)).trim();
  // **Only a length chip gives a day count.** Free text like "nine nights"
  // still gives none, because parsing prose would be the model call §30.2
  // forbids. §32.3 removed the other source: the date range that used to be
  // able to imply a length is gone, and a trip is a start date plus a length
  // everywhere in this app.
  //
  // `daysFor`, never a bare index: `LENGTH_DAYS["constructor"]` reads the
  // prototype and hands back a function (CodeRabbit, PR #188).
  const days = where === undefined ? null : daysFor(state.answers.len);
  // Both halves, and the answer as well as the ISO: `start` present in the
  // answers is what says the reader actually fixed a day, and `arrive` is the
  // machine-readable half of that same answer.
  const dated = state.answers.start !== undefined && ISO_DATE.test(arrive) && days !== null;

  /** The names of these offered days, in the order given. */
  const namesOf = (ids: readonly string[]) =>
    ids.flatMap((id) => state.offer?.find((day) => day.savedDayId === id)?.name ?? []);

  /** Make the trip and apply what was answered. `null` when nothing was made. */
  async function run(applySetup: boolean, tripName = name): Promise<Extract<SetupResult, { ok: true }> | null> {
    if (tripName === "" || submitting) return null;
    setError(null);
    setSubmitting(true);

    const result = await createTripWithSetup({
      setup: {
        name: tripName,
        // Never the raw picker value on its own: `dated` is what says this ISO
        // is still the live answer, so a replaced arrival cannot date the trip.
        arrive: dated ? arrive : "",
        days,
        // **No budget or currency turn exists in this script**, so this UI never
        // populates either. The branches for them stay in `newTripSubmit.ts` —
        // tested directly there — because a later plan may reintroduce the
        // fields, and deleting working code that a closed known issue depends
        // on is not a saving.
        budget: null,
        currency: DEFAULT_CURRENCY,
        savedDayIds: state.chosen ?? [],
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
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return null;
    }
    setMissed(namesOf(result.missedDays));
    return result;
  }

  async function submit(applySetup: boolean, tripName = name): Promise<boolean> {
    const result = await run(applySetup, tripName);
    if (result === null) return false;
    // **A chosen day that did not land keeps the conversation on screen**, so
    // the closing line can say which — navigating straight past it would lose
    // the only place that is said. "Open the trip" is one click away.
    if (result.missedDays.length > 0) {
      setPhase("made");
      return true;
    }
    onDone(result.latch.tripId, applySetup);
    return true;
  }

  /**
   * **Show the typing row for `ms`**, resolving when it ends. A second call
   * ends the first one early rather than leaving its caller waiting forever.
   */
  function pause(kind: "answer" | "draft", ms: number): Promise<void> {
    if (typingTimer.current !== null) clearTimeout(typingTimer.current);
    endTyping.current?.();
    setTyping(kind);
    return new Promise((resolve) => {
      const end = () => {
        typingTimer.current = null;
        endTyping.current = null;
        resolve();
      };
      endTyping.current = end;
      typingTimer.current = setTimeout(() => {
        setTyping(null);
        end();
      }, ms);
    });
  }

  /**
   * **Ask the library for this city's published days** (M27 D13). Fired on the
   * `where` commit, so it runs while the typing row shows; what it has found
   * when the row ends is what is offered. A failed read and a slow one both
   * leave `days` empty, which skips the turn — it never blocks the script.
   */
  function lookUp(where: string): number {
    const token = pbRead.current.token + 1;
    pbRead.current = { token, days: [] };
    const city = cityOf(where);
    if (city !== "") {
      void searchPlaybooks({ cities: [city], sort: "most-added" }).then((result) => {
        if (pbRead.current.token !== token || !result.ok) return;
        pbRead.current = {
          token,
          days: pickPopularDays(result.value.days, (ownerId) => displayNameFor({ userId: ownerId })),
        };
      });
    }
    return token;
  }

  /**
   * The last turn's commit: make the trip, then say what was made.
   *
   * **The phase moves only after the trip exists** (CodeRabbit, PR #188).
   * Setting `"made"` first meant a failed create still printed "<name> is
   * created" and swapped the retry controls for "Open the trip" — and when it
   * was `createTrip` itself that failed, `progress` was still null, so that
   * button closed the sheet without ever calling `onCreated`. The error was
   * on screen the whole time, underneath a sentence contradicting it.
   *
   * **The create runs under the *Drafting the trip…* row, not after it** (M27
   * D14), and the trip is described only once BOTH are done: the pause is
   * presentation, so it must never add to the wait, and the summary must never
   * arrive before the beat that introduces it.
   *
   * `typed` is the words from the composer on the `feel` turn — the one turn
   * whose answer ends the flow, so it has to go through here rather than
   * through `commit`.
   */
  async function finish(typed?: string) {
    setState(typed === undefined ? commitMulti(state) : commitAnswer(state, typed));
    setDraft("");
    const [result] = await Promise.all([run(true), pause("draft", CASS_DRAFTING_MS)]);
    if (result === null) return;
    setPhase("made");
    if (result.missedDays.length === 0) onDone(result.latch.tripId, true);
  }

  /** The beat after an answer; after `where` it also freezes the offer. */
  function reply(readToken: number | null) {
    void pause("answer", CASS_TYPING_MS).then(() => {
      if (readToken === null) return;
      const found = pbRead.current.token === readToken ? pbRead.current.days : [];
      setState((current) => offerDays(current, found));
    });
  }

  function commit(value: string) {
    if (value.trim() === "") return;
    // Refocus the dock when it comes back, if that is where the reader was:
    // the typing row unmounts it, and a keyboard user's focus would otherwise
    // fall to the page and stay there.
    refocus.current = dockRef.current?.contains(document.activeElement) ?? false;
    if (question?.id === "feel") {
      if (!disabled && !submitting) void finish(value);
      return;
    }
    // **Typing over the arrival replaces a fixed day with prose**, so the ISO
    // behind it goes too — otherwise "early October" reads as the answer while
    // a day the reader overwrote is still dating the trip (SPEC §32.3).
    //
    // The OTHER way a picked day stops being the answer — revising the date
    // question away from *Yes* — deliberately has no line here. `commitAnswer`
    // drops `answers.start`, and `dated` below requires it, so a `setArrive("")`
    // on that branch is unreachable as a defect: written, it passed every
    // mutation, which is how it was found. The half that holds it is the
    // `state.answers.start !== undefined` in `dated`, and that is where the
    // test points.
    if (question?.id === "start") setArrive("");
    setState((current) => commitAnswer(current, value));
    setDraft("");
    reply(question?.id === "where" ? lookUp(value.trim()) : null);
  }

  /** The Playbook-day turn's commit: the picked days, or a fresh plan. */
  function commitPicks() {
    refocus.current = dockRef.current?.contains(document.activeElement) ?? false;
    setState((current) => commitMulti(current));
    reply(null);
  }

  /**
   * **Commits the arrival from the day picker** (§32.3's one date control).
   *
   * The answer that lands in the transcript is the app's own date style, never
   * the picker's ISO: *"a conversational surface showing `2027-04-10` reads
   * machine-generated and drifts from every other date in the product."* That
   * is why this formats here, at the commit, rather than anywhere downstream —
   * the raw value never enters the thread, the closing line, or the trip.
   */
  function commitArrival() {
    if (!ISO_DATE.test(arrive)) return;
    refocus.current = dockRef.current?.contains(document.activeElement) ?? false;
    setState((current) => commitAnswer(current, formatTripDateWithYear(arrive)));
    setDraft("");
    reply(null);
  }

  // **D-C, answered 2026-09-16.** The design's `made` copy says the trip was
  // "laid out ... around" the `feel` answer. It was not: `pace` and `feel` are
  // collected and stored nowhere, and nothing consumes them until the theme
  // pass and the fork land. A closing turn claiming otherwise would be a
  // fabricated note in a repo that keeps a registry to mark exactly those.
  //
  // §35.8 adds two things and D-C survives both. The line opens with "Done." —
  // it is Cass's reply now, not a receipt — and a day chosen on the
  // Playbook-day turn IS in the trip, so it is named, and "the days are empty"
  // stops being true of all of them. A chosen day that did not land is named
  // too: said, not silently dropped.
  const placed = namesOf(state.chosen ?? []).filter((each) => !missed.includes(each));
  const closing =
    phase === "made"
      ? `Done. ${name} is created${days === null ? "" : `, ${days} days`}` +
        `${dated ? ` from ${formatTripDateWithYear(arrive)}` : ""}. ` +
        (placed.length === 0
          ? "The days are empty and yours to fill"
          : `${listed(placed)} ${placed.length === 1 ? "is" : "are"} already in place; the rest is yours to fill`) +
        " — what you said about pace and what the trip is about is not built in yet." +
        (missed.length === 0
          ? ""
          : ` ${listed(missed)} could not be added — ${missed.length === 1 ? "it is" : "they are"} still in Playbooks.`)
      : null;

  // §30.3's fork reads the account's CAPABILITY, not its plan. Asked here
  // rather than at the split so the read is in flight from the first question —
  // by the time the fifth answer lands it has long resolved, and the
  // permissive-`null` branch below is a first-frame guard rather than the
  // common case.
  const aiEntitled = useAiEntitled();

  // The draft row stays up for as long as the create itself takes, not only
  // for its own 1300ms — a slow create otherwise leaves the thread ending on
  // the reader's answer with nothing to say what is happening.
  const shownTyping =
    typing ?? (submitting && phase === "asking" && question === undefined ? "draft" : null);
  const thread = threadFor(state, closing, openingFor(firstRun, firstName), shownTyping);
  const answered = Object.keys(state.answers).length > 0;
  // The dock waits behind the typing row with everything else (§35.8).
  const asking = phase === "asking" && question !== undefined && shownTyping === null;
  const pickedCount = state.picked.length;
  // §35.9: *"A hint above them … shown only when the turn has chips."*
  const hint =
    question === undefined || question.chips.length === 0
      ? null
      : question.multi === true
        ? "Pick any that fit — or type your own"
        : "Tap one to answer — or type your own";
  const place = firstRun ? "page" : "sheet";

  useEffect(() => {
    if (!asking || !refocus.current) return;
    refocus.current = false;
    dockRef.current?.querySelector<HTMLElement>("input, button")?.focus();
  }, [asking]);

  return (
    // **`h-full`, and it is the whole reason this reads as a chat box** — the
    // defect Mitchell caught on the `5c27d37` preview: *"the input and
    // decisions are at bottom, and the chat at top, this should look like a
    // chat box"*.
    //
    // `Sheet` puts every child inside its own `flex-1 overflow-y-auto`
    // scrollport, which is a BLOCK. A block sizes its child to content, so
    // `flex-1` on the transcript below had nothing to fill: the thread grew
    // the sheet, the dock was pushed down with it, and the composer scrolled
    // out of reach as the conversation got longer — §31.3's "original sin"
    // exactly, reintroduced one level up from where it was fixed.
    // `FirstTripStart` never showed it because it bounds this with
    // `h-a-thread`; the sheet path had no bound at all.
    //
    // `h-full` takes the scrollport's resolved height, so this column is
    // definite, `min-h-0` bites, and the transcript becomes the ONLY thing
    // that scrolls. The sheet's own scrollport then never has anything to
    // scroll, which is what keeps the dock nailed to the foot.
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* **No stepper.** §30.1: the rail is not replaced with a progress bar —
          a transcript shows its own progress, and the stepper was what made the
          sheet grow as it filled.

          **The transcript is the only thing that scrolls** (§31.3). `mt-auto`
          on the inner wrapper is what bottom-aligns a short thread against the
          dock, so the newest turn always sits directly above the answer — and
          it is used instead of `justify-end` on the scrollport, which clips the
          top of an overflowing column in more than one engine. */}
      <div ref={threadRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
        <div className="mt-auto">
        <Transcript
          look="chat"
          turns={thread}
          renderTurnFooter={(turn) => {
            // Not while Cass is typing: going back mid-reply would leave the
            // row resolving into a question that is no longer being asked.
            if (turn.role !== "user" || phase === "made" || shownTyping !== null) return null;
            const index = questions.findIndex((q) => `said-${q.id}` === turn.id);
            if (index < 0 || index === state.turn) return null;
            return (
              <div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-auto px-0 text-xs font-normal"
                  onClick={() => {
                    setState((current) => changeTo(current, index));
                    setDraft("");
                  }}
                >
                  Change
                </Button>
              </div>
            );
          }}
        />

        {/* **The fork at the end, on plan** — §30.3, M26 link 9a. It sits
            INSIDE the scrolling half, above the dock: it is something to read,
            not something to answer with, and under the composer it was one of
            the two blocks that stopped the input being the last thing on
            screen.

            **After the fifth ANSWER, not on the fifth question.** §30.3 is
            explicit — *"After the fifth answer the flow splits"* — and this
            used to render on the last question, before it was answered, which
            put a claim about the trip on screen before there was a trip.

            **The split is on the entitlement, never on a plan name**
            (ADR-045 rule 4; `planVersions.fourthPlan.test.ts` greps source for
            exactly that comparison). `useAiEntitled` answers what the account
            HOLDS, so a fourth plan granting the assistant works here with no
            edit.

            **`null` takes the PAID branch, and that asymmetry is deliberate.**
            `useAiEntitled` returns `null` while unknown AND on a failed read,
            and its own note says every caller must treat that as entitled:
            flashing a paywall at a subscriber is a worse failure than showing
            a free account one optimistic frame. Being wrong the permissive way
            costs nothing here at all — this branch is a `Preview`, which
            promises nothing. */}
        {phase === "made" &&
          (aiEntitled === false ? (
            <NewTripPlusNote />
          ) : (
            <Preview id="wizard-assistant-draft" size="container" className="mt-4 bg-brand-tint p-3.5">
              <Text className="font-semibold text-brand-pressed">Let the assistant draft it</Text>
              <Text variant="secondary" className="mt-0.5 text-brand-pressed">
                Once you say go, the assistant lays out your days at the pace you pick, leaves the
                bookings to you, and flags anything that needs a decision.
              </Text>
            </Preview>
          ))}
        </div>
      </div>

      {/* **Everything you answer with, in one block at the foot** — the dock
          (§31.3) and the decisions that end the flow, behind a single hairline
          rule and pinned under the transcript. They were two blocks with a
          `Preview` between them, so "the input" and "the decisions" were
          separated by something that is neither. `shrink-0` so a long thread
          squeezes the scrollport, never this. */}
      <div className="flex shrink-0 flex-col gap-2.5 border-t border-hairline pt-3">
      {/* **The answer dock** (§31.3): one unit at the foot, separated by a
          single hairline rule, in a fixed order — the day picker, chips, the
          multi commit, then the field. It does not scroll, and the
          per-question chip label is gone: with the chips inside the composer's
          own frame it was captioning the obvious. A chip and a typed sentence
          fill the same answer and commit the same turn. */}
      {asking && (
        <div ref={dockRef} className="flex flex-col gap-2.5">
          {/* **One day, not a range** (§32.3). The turn before this one asked
              whether there is a date at all, so this control only ever appears
              for a reader who said yes — and it asks for the single thing the
              rest of the app models, a start. The length is the next turn's
              job, and no date input appears there. */}
          {question.dates === true && (
            <div className="flex flex-wrap items-end gap-2">
              <FormField id="wizard-arrive" label="Arrive">
                <Input
                  id="wizard-arrive"
                  type="date"
                  className={TOUCH}
                  value={arrive}
                  onChange={(e) => setArrive(e.target.value)}
                  aria-label="Arrive"
                />
              </FormField>
              <Button
                type="button"
                variant="secondary"
                className={TOUCH}
                disabled={!ISO_DATE.test(arrive)}
                onClick={commitArrival}
              >
                Use this date
              </Button>
            </div>
          )}

          {/* **The Playbook-day turn** (§35.8, M27 D13): published days for
              the answered city, as cards rather than chips because each one
              carries a name, a count and an author. Multi-select, and each
              card says what it is — `aria-pressed` plus the visible
              "✓ Added" / "Add" — so the state is never colour alone. */}
          {question.offer !== undefined && (
            <div>
              <p className="mb-1.75 text-xs font-semibold text-brand-pressed">
                Add any to the trip — or skip
              </p>
              <div role="group" aria-label="Popular days" className="flex flex-col gap-1.5">
                {question.offer.map((day) => {
                  const on = state.picked.includes(day.savedDayId);
                  return (
                    // `rounded-lg`, 12px, where the design draws 10: the
                    // card's own `rounded-a-card` cannot win through
                    // `ToggleChip`'s `cn` — tailwind-merge does not know the
                    // token, so it keeps both radii and lets CSS order pick.
                    <ToggleChip
                      key={day.savedDayId}
                      pressed={on}
                      onClick={() => setState((current) => togglePick(current, day.savedDayId))}
                      className={`flex-row items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-ink ${
                        on ? "" : "border-hairline hover:border-border-strong"
                      }`}
                    >
                      <span className="flex min-w-0 flex-auto flex-col gap-0.5">
                        <span className="text-base font-semibold">{day.name}</span>
                        <span className="text-a-note text-pretty text-slate">{metaFor(day)}</span>
                      </span>
                      <span
                        className={`shrink-0 text-a-note font-semibold ${on ? "text-brand-pressed" : "text-brand"}`}
                      >
                        {on ? "✓ Added" : "Add"}
                      </span>
                    </ToggleChip>
                  );
                })}
              </div>
            </div>
          )}

          {question.chips.length > 0 && (
            <div>
              {hint !== null && (
                <p className="mb-1.75 text-xs font-semibold text-brand-pressed">{hint}</p>
              )}
              <div className="flex flex-wrap gap-1.5">
                {question.chips.map((chip) => (
                  // Buttons, never a `<select>`: `preview-registry.test.ts` has
                  // a wall against a static city `<option>` list anywhere in src.
                  <AnswerPill
                    key={chip}
                    place={place}
                    {...(question.multi === true ? { pressed: state.picked.includes(chip) } : {})}
                    onClick={() =>
                      question.multi === true
                        ? setState((current) => togglePick(current, chip))
                        : commit(chip)
                    }
                  >
                    {chip}
                  </AnswerPill>
                ))}
              </div>
            </div>
          )}

          {/* The multi commit is secondary until something is picked, then the
              primary (§35.9) — "Nothing in particular" is a real answer, but not
              the one the dock should be pushing. */}
          {question.multi === true && (
            <Button
              type="button"
              variant={pickedCount > 0 ? "primary" : "secondary"}
              className={TOUCH}
              disabled={question.offer === undefined && (disabled || submitting)}
              onClick={() => (question.offer === undefined ? void finish() : commitPicks())}
            >
              {question.offer !== undefined
                ? pickedCount === 0
                  ? "Skip — plan it fresh"
                  : pickedCount === 1
                    ? "Build around this day"
                    : `Build around these ${pickedCount}`
                : pickedCount > 0
                  ? "That is it — build it"
                  : "Nothing in particular"}
            </Button>
          )}

          {/* The composer is on every turn, the multi ones included: §35.9's
              hint says "or type your own", and a hint promising a field that
              is not there would be a lie told in the one place a reader is
              looking for what to do. */}
            <div className="flex items-end gap-2">
              <div className="flex-1">
                {/* **The composer's accessible name is the QUESTION**, not
                    "Trip name". That is the honest name for a field whose label
                    is whatever is being asked — and it is why the e2e suite
                    grew `createEmptyTripViaWizard` first, so the rename landed
                    in one place rather than fifteen. */}
                <Input
                  {...(composerId === undefined ? {} : { id: composerId })}
                  className={TOUCH}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={submitOnEnter(() => commit(draft))}
                  placeholder={question.placeholder}
                  aria-label={question.ask}
                />
              </div>
              <Button
                type="button"
                variant="secondary"
                className={TOUCH}
                disabled={draft.trim() === ""}
                onClick={() => commit(draft)}
              >
                Send
              </Button>
            </div>
        </div>
      )}

      {error !== null && (
        <Text as="p" role="alert" className="text-danger-ink">
          {error}
        </Text>
      )}

      {/* **The rare ways in, as one quiet row** (SPEC §35.2). *Create empty*
          was a footer button beside *Create with this*, from turn one — so the
          first thing the sheet offered, before a single answer, was a
          full-weight way to skip it. It is a link now, with the other two
          routes that do not start from a conversation.

          Gone once the trip is made: there is nothing left to start. */}
      {phase === "asking" && (
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 px-0.5 text-xs text-slate">
          <span>Or</span>
          {otherStarts !== undefined && (
            <>
              {/* A link, because it is a navigation; the click also closes the
                  sheet, which would otherwise ride along over Discover. */}
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
            onClick={() => void submit(false, name === "" ? UNTITLED_TRIP : name)}
          >
            create an empty one
          </Button>
        </div>
      )}

      {/* **Drawn only when it has something in it** (§35.2): *Create with
          this* once there is an answer to create with, *Open the trip* once it
          is made. An empty footer is a rule and a band of padding under
          nothing. *Open the trip* also waits out Cass's drafting beat, as the
          design's `ntFooterOn` does, so it never arrives before the line that
          says what was made. */}
      {((phase === "made" && typing === null) || (phase === "asking" && answered)) && (
        <DialogFooter>
          {phase === "made" ? (
            <Button
              type="button"
              variant="primary"
              className={TOUCH}
              disabled={submitting}
              onClick={() => onDone(progress?.tripId ?? null, true)}
            >
              Open the trip
            </Button>
          ) : (
            <Button
              type="button"
              variant="primary"
              className={TOUCH}
              disabled={disabled || submitting}
              onClick={() => void submit(true)}
            >
              Create with this
            </Button>
          )}
        </DialogFooter>
      )}
      </div>
    </div>
  );
}
