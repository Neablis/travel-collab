"use client";

import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Heading } from "@/components/ui/heading";
import { Text } from "@/components/ui/text";
import { DEMO_PATH } from "@/lib/demoTrip";
import { cn } from "@/lib/cn";

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

/** The four steps `NewTripWizard` walks, said before it opens rather than after. */
const WIZARD_STEPS: readonly { label: string; detail: string }[] = [
  { label: "Where", detail: "A name is enough — “Japan”, “Mum’s 60th”." },
  { label: "When", detail: "Pick a length and an arrival, or skip it." },
  { label: "Who & money", detail: "A budget to measure against, if you have one." },
  { label: "Shape", detail: "How full the days should feel." },
];

export function FirstTripStart({ onStart }: { onStart: () => void }) {
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

      {/* Said up front, because "four steps" is what makes a wizard feel
          finishable — and because every step after the first is genuinely
          optional, which is not obvious from inside a step. */}
      <ol className="grid grid-cols-1 gap-2.5 sm:grid-cols-2" data-testid="first-trip-steps">
        {WIZARD_STEPS.map((step, index) => (
          <li key={step.label} className="flex gap-2.5 rounded-lg bg-moss p-3">
            <span
              aria-hidden
              className="flex size-5 shrink-0 items-center justify-center rounded-full bg-surface text-xs font-semibold text-slate"
            >
              {index + 1}
            </span>
            <div className="min-w-0">
              <Text as="span" className="block text-sm font-semibold text-ink">
                {step.label}
              </Text>
              <Text as="span" variant="secondary" className="block text-sm">
                {step.detail}
              </Text>
            </div>
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="primary" onClick={onStart}>
          Name your trip
        </Button>
        {/* The library, which is the real answer to "from total scratch is
            rough": somebody has already planned a good day in the place you are
            going, and taking it is one click. It was reachable from the page
            head and from the end of a trip — never from the screen where a
            person has no trip to be at the end of. */}
        <Link href="/playbooks" className={cn(buttonVariants({ variant: "secondary", size: "md" }))}>
          Start from a Playbook
        </Link>
        {/* The third route, and the only one that costs nothing: look at a
            finished trip before making one. `/demo` is the same board with the
            changes turned off (ADR-031), and it carries its own "make this
            trip mine". */}
        <Link href={DEMO_PATH} className={cn(buttonVariants({ variant: "ghost", size: "md" }))}>
          Look around an example trip
        </Link>
      </div>
    </Card>
  );
}
