"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import type { ApiResult, BoardCommand, CommandOutcome } from "@/lib/apiClient";
import { Sheet, type SheetSize } from "@/components/ui/sheet";
import { DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Banner } from "@/components/ui/banner";
import { Preview } from "@/components/ui/preview";
import { Text } from "@/components/ui/text";
import { Transcript, type AssistantTurn } from "@/components/assistant/Transcript";
import { usePinToBottom } from "@/components/assistant/usePinToBottom";
import { addDaysIso } from "@/lib/dates";
import { submitOnEnter } from "@/lib/submitOnEnter";
import { formatTripDate } from "@/lib/formatDate";
import {
  LENGTH_DAYS,
  NEW_TRIP_QUESTIONS,
  NEW_TRIP_START,
  changeTo,
  commitAnswer,
  commitMulti,
  togglePick,
  type NewTripState,
} from "./newTripScript";
import {
  DEFAULT_CURRENCY,
  ISO_DATE,
  createTripWithSetup,
  type SetupLatch,
} from "./newTripSubmit";

export type NewTripWizardProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  createTrip: (input: { name: string }) => Promise<ApiResult<{ tripId: string }>>;
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
  /**
   * `full` on a first run — see `SheetSize`. The caller decides, because
   * "do you have any trips yet" is the trip LIST's question, not the wizard's.
   */
  size?: SheetSize;
  /**
   * First-run framing: a line under the title saying what this is for, and a
   * way out that is not the ✕. Withheld for the ordinary "New trip" press,
   * where the person already knows.
   */
  firstRun?: boolean;
  /** First-run only: "or take a day somebody else already planned". */
  browseHref?: string;
};

export function NewTripWizard({
  open,
  onOpenChange,
  createTrip,
  dispatch,
  onCreated,
  size = "rail",
  firstRun = false,
  browseHref = "/playbooks",
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
        <WizardBody
          createTrip={createTrip}
          dispatch={dispatch}
          firstRun={firstRun}
          browseHref={browseHref}
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
 * wait for. SPEC §30.2 — the four turns make **zero model calls and zero
 * network calls**, so a typing indicator here would be an animation pretending
 * to be latency.
 */
function threadFor(state: NewTripState, closing: string | null): AssistantTurn[] {
  const turns: AssistantTurn[] = [];
  NEW_TRIP_QUESTIONS.forEach((question, index) => {
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

function WizardBody({
  createTrip,
  dispatch,
  onDone,
  firstRun,
  browseHref,
}: {
  createTrip: NewTripWizardProps["createTrip"];
  dispatch: NewTripWizardProps["dispatch"];
  onDone: (tripId: string | null, navigate: boolean) => void;
  firstRun: boolean;
  browseHref: string;
}) {
  const [state, setState] = useState<NewTripState>(NEW_TRIP_START);
  const [phase, setPhase] = useState<"asking" | "made">("asking");
  const [draft, setDraft] = useState("");
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

  const question = NEW_TRIP_QUESTIONS[state.turn];
  const where = state.answers.where;
  // The trip's name is the destination answer, or whatever is in the composer
  // before it has been committed — which is what preserves "type a name, press
  // Create empty" exactly as the old single-field dialog worked.
  const name = (where ?? draft).trim();
  // Only a LENGTH CHIP gives a day count. Free text like "nine nights in April"
  // gives none, because parsing it would be the model call §30.2 forbids.
  const days = where === undefined ? null : (LENGTH_DAYS[state.answers.when ?? ""] ?? null);
  const dated = ISO_DATE.test(arrive) && days !== null;

  async function submit(applySetup: boolean) {
    if (name === "" || submitting) return;
    setError(null);
    setSubmitting(true);

    const result = await createTripWithSetup({
      setup: {
        name,
        arrive,
        days,
        // **No budget or currency turn exists in a four-turn script**, so this
        // UI never populates either. The branches for them stay in
        // `newTripSubmit.ts` — tested directly there — because a later plan may
        // reintroduce the fields, and deleting working code that a closed known
        // issue depends on is not a saving.
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
      return;
    }
    onDone(result.latch.tripId, applySetup);
  }

  /** The last turn's commit: make the trip, then say what was made. */
  async function finish() {
    const committed = commitMulti(state);
    setState(committed);
    setPhase("made");
    await submit(true);
  }

  function commit(value: string) {
    setState((current) => commitAnswer(current, value));
    setDraft("");
  }

  // **D-C, answered 2026-09-16.** The design's `made` copy says the trip was
  // "laid out ... around" the `feel` answer. It was not: `pace` and `feel` are
  // collected and stored nowhere, and nothing consumes them until the theme
  // pass and the fork land. A closing turn claiming otherwise would be a
  // fabricated note in a repo that keeps a registry to mark exactly those.
  const closing =
    phase === "made"
      ? `${name} is created, ${days ?? 0} days${dated ? ` from ${formatTripDate(arrive)}` : ""}. ` +
        "The days are empty and yours to fill — what you said about pace and what the trip is " +
        "about is not built in yet."
      : null;

  const thread = threadFor(state, closing);
  const answered = Object.keys(state.answers).length > 0;

  return (
    <div className="flex min-h-0 flex-col gap-4">
      {/* The first-run framing, and the answer to "building a trip from total
          scratch is a rough experience" (Mitchell, 2026-09-01). Only on a first
          run: someone opening "New trip" for their fourth trip has met all of
          this. */}
      {firstRun && (
        <div className="flex flex-col gap-2 rounded-lg bg-moss p-3.5">
          <Text as="p" variant="secondary" className="text-pretty">
            A name is enough to start — dates, days and everyone else can come later, and nothing
            here is locked in. Every step after this one is optional.
          </Text>
          <Text as="p" variant="secondary" className="text-pretty">
            Rather not start from nothing?{" "}
            <Link href={browseHref} className="font-semibold text-brand underline">
              Take a day somebody has already planned
            </Link>{" "}
            and build the trip around it.
          </Text>
        </div>
      )}

      {/* **No stepper.** §30.1: the rail is not replaced with a progress bar —
          a transcript shows its own progress, and the stepper was what made the
          sheet grow as it filled. */}
      <div ref={threadRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
        <Transcript
          turns={thread}
          renderTurnFooter={(turn) => {
            if (turn.role !== "user" || phase === "made") return null;
            const index = NEW_TRIP_QUESTIONS.findIndex((q) => `said-${q.id}` === turn.id);
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

      {phase === "asking" && question !== undefined && (
        <div className="flex flex-col gap-2.5">
          {question.chipLabel !== "" && (
            <Text variant="muted" className="mb-0.5">
              {question.chipLabel}
            </Text>
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
                className="rounded-full"
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

          {question.dates === true && (
            <>
              <FormField id="wizard-arrive" label="Arrive">
                <Input
                  id="wizard-arrive"
                  type="date"
                  value={arrive}
                  onChange={(e) => setArrive(e.target.value)}
                  aria-label="Arrive"
                />
              </FormField>
              {/* Real, not Preview: both the start and the length come from
                  real state, so this is honest derived data. */}
              {dated && (
                <Banner variant="info">
                  {days} days — {formatTripDate(arrive)} to{" "}
                  {formatTripDate(addDaysIso(arrive, (days ?? 1) - 1))}.
                </Banner>
              )}
            </>
          )}

          {question.multi === true ? (
            <Button type="button" variant="primary" disabled={submitting} onClick={() => void finish()}>
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
      {phase === "asking" && state.turn === NEW_TRIP_QUESTIONS.length - 1 && (
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
              disabled={name === "" || submitting}
              onClick={() => void submit(false)}
            >
              Create empty
            </Button>
            {answered && (
              <Button
                type="button"
                variant="primary"
                disabled={submitting}
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
