"use client";

import { useRef, useState } from "react";
import type { ApiResult, BoardCommand, CommandOutcome } from "@/lib/apiClient";
import { Sheet, type SheetSize } from "@/components/ui/sheet";
import { DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Preview } from "@/components/ui/preview";
import { Text } from "@/components/ui/text";
import { Transcript, type AssistantTurn } from "@/components/assistant/Transcript";
import { usePinToBottom } from "@/components/assistant/usePinToBottom";
import { submitOnEnter } from "@/lib/submitOnEnter";
// `…WithYear`, not `formatTripDate`: §32.3's own example of "the app's own
// style" is `Apr 10, 2027`, and a trip being planned eleven months out is the
// ordinary case here. The weekday-first variant the board uses drops the year,
// which reads fine on a day inside an open trip and badly as the answer to
// "when do you arrive".
import { formatTripDateWithYear } from "@/lib/formatDate";
import {
  LENGTH_DAYS,
  NEW_TRIP_OPENING,
  NEW_TRIP_OPENING_FIRST_RUN,
  NEW_TRIP_START,
  changeTo,
  commitAnswer,
  commitMulti,
  questionAt,
  questionsFor,
  togglePick,
  type NewTripState,
} from "./newTripScript";
import {
  DEFAULT_CURRENCY,
  ISO_DATE,
  createTripWithSetup,
  type SetupLatch,
} from "./newTripSubmit";

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
const TOUCH = "min-h-11 sm:min-h-0";

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
  // conversation — "Create empty" is the old single-field dialog's escape
  // hatch, and that dialog never navigated: it closed and left the user on the
  // trip list to open the new card themselves. Every pre-Phase-7 e2e spec is
  // built on that, and a version of this that always navigated broke every one
  // of them (CI, PR #32) by leaving the home page before the click ever ran.
  onCreated?: (tripId: string, opts: { navigate: boolean }) => void;
  /** See `SheetSize`. The caller decides how much of the window this takes. */
  size?: SheetSize;
};

export function NewTripWizard({
  open,
  onOpenChange,
  createTrip,
  dispatch,
  onCreated,
  size = "rail",
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
 * `pending: false` and `tools: []` on every assistant turn: there is nothing to
 * wait for. SPEC §30.2 — the turns make **zero model calls and zero network
 * calls**, so a typing indicator here would be an animation pretending to be
 * latency.
 *
 * The list comes from `questionsFor(state.answers)` rather than a constant,
 * because §32.3's flow is five turns or six depending on the date answer, and a
 * thread built from a stale list would print a question the reader is no longer
 * being asked.
 */
function threadFor(state: NewTripState, closing: string | null, opening: string): AssistantTurn[] {
  const turns: AssistantTurn[] = [
    // **§31.2 — one line before any question.** It states §30.2's contract in
    // the reader's own reading order, and it means turn one is never an empty
    // pane with a dock under it.
    { id: "opening", role: "assistant", text: opening, tools: [], pending: false },
  ];
  questionsFor(state.answers).forEach((question, index) => {
    if (index > state.turn) return;
    turns.push({
      id: `ask-${question.id}`,
      role: "assistant",
      text: question.ask,
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
  return turns;
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
export function NewTripConversation({
  createTrip,
  dispatch,
  onDone,
  firstRun = false,
  composerId,
  disabled = false,
}: {
  createTrip: NewTripWizardProps["createTrip"];
  dispatch: NewTripWizardProps["dispatch"];
  onDone: (tripId: string | null, navigate: boolean) => void;
  /**
   * Somebody's first trip, which changes exactly one thing here: the line the
   * thread opens with (SPEC §32.1). "I will draft the trip" has no antecedent
   * on a screen with no trips behind it.
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
}) {
  const [state, setState] = useState<NewTripState>(NEW_TRIP_START);
  const [phase, setPhase] = useState<"asking" | "made">("asking");
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
  usePinToBottom(threadRef, [state.turn, phase]);

  const questions = questionsFor(state.answers);
  const question = questionAt(state);
  const where = state.answers.where;
  // The trip's name is the destination answer, or whatever is in the composer
  // before it has been committed — which is what preserves "type a name, press
  // Create empty" exactly as the old single-field dialog worked.
  //
  // **While `where` is the live question, the composer wins** (CodeRabbit, PR
  // #188). `changeTo` keeps the answers rather than clearing them, so pressing
  // Change back to turn one leaves the OLD destination committed; typing a new
  // one and pressing Create empty then made a trip named the thing on screen a
  // moment ago, not the thing in the field. An uncommitted edit to the question
  // being asked is the more recent intent.
  const composing = question?.id === "where" && draft.trim() !== "";
  const name = (composing ? draft : (where ?? draft)).trim();
  // **Only a length chip gives a day count.** Free text like "nine nights"
  // still gives none, because parsing prose would be the model call §30.2
  // forbids. §32.3 removed the other source: the date range that used to be
  // able to imply a length is gone, and a trip is a start date plus a length
  // everywhere in this app.
  const days = where === undefined ? null : (LENGTH_DAYS[state.answers.len ?? ""] ?? null);
  // Both halves, and the answer as well as the ISO: `start` present in the
  // answers is what says the reader actually fixed a day, and `arrive` is the
  // machine-readable half of that same answer.
  const dated = state.answers.start !== undefined && ISO_DATE.test(arrive) && days !== null;

  async function submit(applySetup: boolean): Promise<boolean> {
    if (name === "" || submitting) return false;
    setError(null);
    setSubmitting(true);

    const result = await createTripWithSetup({
      setup: {
        name,
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
      },
      applySetup,
      latch: progress,
      createTrip,
      dispatch,
    });

    // Stored on BOTH outcomes: dropping the latch on failure is the defect
    // `newTripSubmit.ts`'s own header describes.
    if (result.latch !== null) setProgress(result.latch);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    onDone(result.latch.tripId, applySetup);
    return true;
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
   */
  async function finish() {
    const committed = commitMulti(state);
    setState(committed);
    if (await submit(true)) setPhase("made");
  }

  function commit(value: string) {
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
    setState((current) => commitAnswer(current, formatTripDateWithYear(arrive)));
    setDraft("");
  }

  // **D-C, answered 2026-09-16.** The design's `made` copy says the trip was
  // "laid out ... around" the `feel` answer. It was not: `pace` and `feel` are
  // collected and stored nowhere, and nothing consumes them until the theme
  // pass and the fork land. A closing turn claiming otherwise would be a
  // fabricated note in a repo that keeps a registry to mark exactly those.
  const closing =
    phase === "made"
      ? `${name} is created${days === null ? "" : `, ${days} days`}` +
        `${dated ? ` from ${formatTripDateWithYear(arrive)}` : ""}. ` +
        "The days are empty and yours to fill — what you said about pace and what the trip is " +
        "about is not built in yet."
      : null;

  const thread = threadFor(
    state,
    closing,
    firstRun ? NEW_TRIP_OPENING_FIRST_RUN : NEW_TRIP_OPENING,
  );
  const answered = Object.keys(state.answers).length > 0;

  return (
    <div className="flex min-h-0 flex-col gap-4">
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
            if (turn.role !== "user" || phase === "made") return null;
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
        </div>
      </div>

      {/* **The answer dock** (§31.3): one unit at the foot, separated by a
          single hairline rule, in a fixed order — the day picker, chips, the
          multi commit, then the field. It does not scroll, and the
          per-question chip label is gone: with the chips inside the composer's
          own frame it was captioning the obvious. A chip and a typed sentence
          fill the same answer and commit the same turn. */}
      {phase === "asking" && question !== undefined && (
        <div className="flex flex-col gap-2.5 border-t border-hairline pt-3">
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

          <div className="flex flex-wrap gap-1.5">
            {question.chips.map((chip) => (
              <Button
                key={chip}
                type="button"
                // Buttons, never a `<select>`: `preview-registry.test.ts` has a
                // wall against a static city `<option>` list anywhere in src.
                variant={
                  question.multi === true && state.picked.includes(chip) ? "primary" : "secondary"
                }
                size="sm"
                className={`rounded-full ${TOUCH}`}
                onClick={() =>
                  question.multi === true
                    ? setState((current) => togglePick(current, chip))
                    : commit(chip)
                }
              >
                {chip}
              </Button>
            ))}
          </div>

          {question.multi === true ? (
            <Button
              type="button"
              variant="primary"
              className={TOUCH}
              disabled={disabled || submitting}
              onClick={() => void finish()}
            >
              {state.picked.length > 0 ? "That is it — build it" : "Nothing in particular"}
            </Button>
          ) : (
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
          )}
        </div>
      )}

      {error !== null && (
        <Text as="p" role="alert" className="text-danger-ink">
          {error}
        </Text>
      )}

      {/* The fork is design §4 and is NOT built in this slice, so its shell
          survives rather than being deleted — removing it would move a false
          claim rather than remove one (plan 4, Task 6). */}
      {phase === "asking" && state.turn === questions.length - 1 && (
        <Preview id="wizard-assistant-draft" size="container" className="bg-brand-tint p-3.5">
          <Text className="font-semibold text-brand-pressed">Let the assistant draft it</Text>
          <Text variant="secondary" className="mt-0.5 text-brand-pressed">
            Once you say go, the assistant lays out your days at the pace you pick, leaves the
            bookings to you, and flags anything that needs a decision.
          </Text>
        </Preview>
      )}

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
          <>
            <Button
              type="button"
              variant="secondary"
              className={TOUCH}
              disabled={disabled || name === "" || submitting}
              onClick={() => void submit(false)}
            >
              Create empty
            </Button>
            {answered && (
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
          </>
        )}
      </DialogFooter>
    </div>
  );
}
