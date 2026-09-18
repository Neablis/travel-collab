"use client";

import Link from "next/link";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { Heading } from "@/components/ui/heading";
import { Text } from "@/components/ui/text";
import { DEMO_PATH } from "@/lib/demoTrip";
import { cn } from "@/lib/cn";
import { NewTripConversation, type NewTripWizardProps } from "./NewTripWizard";

// Somebody's first authenticated screen, and the answer to two pieces of
// feedback that turned out to be the same one (Mitchell, 2026-09-01):
// *"Building a trip from total scratch is a rough experience"* and *"the first
// time walkthrough ... is not working, i get the empty landing screen 'Plan
// your first trip' which is pretty underwhelming on first login."*
//
// What stood here was `EmptyState` — the component this app uses for "your
// filter matched nothing" — carrying one button into a blank name field. That
// is not a walkthrough and it is not a first run; it is the hardest of the
// three routes into this product, offered alone, in the component that means
// "there is nothing here".
//
// So: all three routes, and a straight answer to "what is about to happen".
// None of them is new capability — the wizard, the library and the demo board
// all already existed — they were simply not reachable from the one screen
// where somebody has nothing and needs one.
//
// **2026-09-18: the card stopped DESCRIBING the conversation and became it.**
// Until now this screen listed the questions as a numbered `<ol>` beside a
// button that opened the sheet. Two problems, and the second is the one that
// matters. It was a second account of the same script, so it drifted — it
// shipped a "Who & money" step the flow does not have. And a numbered list of
// steps is the form framing SPEC §31.2 removed from the sheet itself: the
// design's whole point is that this reads as a conversation, and the screen
// that introduces it was arguing the opposite. The conversation now renders
// here directly (`NewTripConversation`), so the first thing a new account sees
// is the first question, already answerable — no click-through, and no list
// that can disagree with the script.

/**
 * Somebody's first screen: the new-trip conversation itself, and the two routes
 * that are not "start from nothing".
 *
 * @param createTrip - Mints the trip; carries the client-minted `tripId`.
 * @param dispatch - Sends the setup commands the answers imply.
 * @param onDone - Called once the trip exists and its commands have confirmed.
 * @param composerId - Lets the page head's "New trip" button focus the answer field.
 * @param disabled - Holds the exits while a demo clone is still in flight.
 * @param showConversation - False while the sheet owns the conversation.
 * @returns The first-trip screen.
 */
export function FirstTripStart({
  createTrip,
  dispatch,
  onDone,
  composerId,
  disabled = false,
  showConversation = true,
}: {
  createTrip: NewTripWizardProps["createTrip"];
  dispatch: NewTripWizardProps["dispatch"];
  onDone: (tripId: string | null, navigate: boolean) => void;
  composerId?: string;
  /** True while a demo clone is landing — see `NewTripConversation`. */
  disabled?: boolean;
  /**
   * **Exactly one composer, and the open sheet wins.**
   *
   * The sheet can be open on this screen: "New trip" is pressable while the
   * trip list is still loading, and `hasNoTrips` is false until it resolves.
   * If the list then lands empty, two composers with the same accessible name
   * would be on one screen — ambiguous to a screen reader, and a strict-mode
   * violation for any test addressing the field by its label.
   *
   * Yielding here is what resolves it. The alternative — closing the sheet —
   * was tried and is worse: it destroys what the reader had already typed into
   * it, which made `createEmptyTripViaWizard` hang on a permanently disabled
   * "Create empty" (e2e, 2026-09-18). The surface a reader is USING is not the
   * one to take away.
   */
  showConversation?: boolean;
}) {
  return (
    <Card raised className="flex flex-col gap-5 p-6" data-testid="first-trip-start">
      <div className="flex flex-col gap-2">
        <Heading level={2}>Plan your first trip</Heading>
        <Text as="p" variant="secondary" className="max-w-2xl text-pretty">
          A name is enough to start. Dates, days and everyone else can come later, and nothing here
          is locked in — every trip is an editable plan with a full history, not a form you have to
          get right.
        </Text>
      </div>

      {/* **The same component the sheet renders**, told it is a first run so
          the thread opens with §32.1's own line — "Welcome. A few quick
          questions and I will draft your first trip". The sheet's line says "I
          will draft the trip", which has no antecedent on a screen with no
          trips behind it. The height is bounded here rather than by a sheet,
          because on a page the transcript must not be the thing that grows the
          card (§31.3's "original sin"). */}
      {showConversation && (
        <div className="flex h-a-thread min-h-0 flex-col" data-testid="first-trip-conversation">
          <NewTripConversation
            createTrip={createTrip}
            dispatch={dispatch}
            onDone={onDone}
            firstRun
            disabled={disabled}
            {...(composerId === undefined ? {} : { composerId })}
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-hairline pt-4">
        <Text as="span" variant="secondary" className="text-sm">
          Rather not start from nothing?
        </Text>
        {/* The library, which is the real answer to "from total scratch is
            rough": somebody has already planned a good day in the place you are
            going, and taking it is one click. It was reachable from the page
            head and from the end of a trip — never from the screen where a
            person has no trip to be at the end of. */}
        <Link href="/playbooks" className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
          Start from a Playbook
        </Link>
        {/* The third route, and the only one that costs nothing: look at a
            finished trip before making one. `/demo` is the same board with the
            changes turned off (ADR-031), and it carries its own "make this
            trip mine". */}
        <Link href={DEMO_PATH} className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
          Look around an example trip
        </Link>
      </div>
    </Card>
  );
}
