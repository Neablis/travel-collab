import { Fragment, type ReactNode, type Ref } from "react";
import Link from "next/link";
import { PHONE_TOUCH, buttonVariants } from "@/components/ui/button";
import { DataText } from "@/components/ui/data-text";
import { Heading } from "@/components/ui/heading";
import { PersonChip } from "@/components/ui/person-chip";
import { cn } from "@/lib/cn";
import type { AccountPlanChoice } from "@/lib/accountPlan";
import { LANDING_DEMO } from "@/lib/landingDemo";
import { LANDING_PLANS } from "@/lib/landingPlans";
import { formatPrice } from "@/lib/planCopy";

/**
 * A plan on the ladder, and the plan it is a step up from: the largest other
 * plan whose entitlements it holds, or null when it holds none.
 */
export type LadderStep = { choice: AccountPlanChoice; base: AccountPlanChoice | null };

/**
 * **The step below each plan, from the entitlement sets** (M51 decision 6). A
 * plan is a set, not a rank (M20), so "Everything in Plus" is true only while
 * Premium holds all of Plus, and the line is worked out per pair, never read
 * off the price or the order the plans arrive in: a plan that stops nesting
 * gets the step it still has (`planVersions.noExtension.test.ts`'s warning).
 */
export function ladder(plans: readonly AccountPlanChoice[]): LadderStep[] {
  const holds = (outer: AccountPlanChoice, inner: AccountPlanChoice) =>
    inner.entitlements.every((entitlement) => outer.entitlements.includes(entitlement));
  return plans.map((choice) => {
    const contained = plans.filter((other) => other !== choice && holds(choice, other) && !holds(other, choice));
    const base = contained.reduce<AccountPlanChoice | null>(
      (best, other) => (best === null || other.entitlements.length > best.entitlements.length ? other : best),
      null,
    );
    return { choice, base };
  });
}

// The people of the demo trip who are going, its owner first: who the step
// that brings the crew in pictures.
const CREW = Object.values(LANDING_DEMO.river.people).filter((person) => person.travelling);
const [OWNER, ...ALONG] = CREW;
const NAMES = new Intl.ListFormat("en", { type: "conjunction" });

/**
 * The assistant at work, as the step that adds it pictures it, drawn in the
 * assistant's own chat look (`Transcript`'s `look="chat"`) on its panel's
 * paper, so it reads as Cass at a glance (Mitchell's third walk of PR 510:
 * *"we can look more at how the real ai agent chat look"*): the reader's turn
 * a right-hand bubble, Cass's answer under its mark and name. The classes are
 * the transcript's; its component holds a live thread this picture has not.
 */
function Assistant(): ReactNode {
  return (
    <div className="flex flex-col gap-a-turn-chat rounded-lg bg-surface p-3 text-ink">
      <p className="max-w-a-you self-end rounded-a-bubble border border-hairline bg-moss px-a-bubble-x py-a-bubble-y text-right text-a-chat leading-a-you text-ink">
        Fill day 9 in Kyoto with something slow.
      </p>
      <div className="flex gap-2">
        <span className="flex w-a-mark shrink-0 justify-center pt-px">
          <span aria-hidden className="relative grid size-a-mark place-items-center rounded-full bg-brand">
            <span className="flex h-3.25 gap-0.75">
              <span className="w-0.75 rounded-a-bar bg-surface" />
              <span className="w-0.75 rounded-a-bar bg-surface" />
            </span>
            <span className="absolute -right-px -bottom-px size-2.25 rounded-full border-2 border-surface bg-success" />
          </span>
        </span>
        <div className="flex min-w-0 max-w-a-asst flex-col gap-1">
          <span className="flex items-baseline gap-1.75">
            <span className="text-sm font-semibold text-ink">Cass</span>
            <span className="text-xs text-slate">Trip planner</span>
          </span>
          <p className="text-base leading-a-asst text-a-asst-ink">Philosopher’s Path in the morning, then tea at Ippodo. Add to Day 9?</p>
        </div>
      </div>
    </div>
  );
}

/** The crew one plan brings along: their chips overlapping, and who pays. */
function Crew({ plan }: { plan: string }): ReactNode {
  return (
    <>
      <span className="flex" aria-hidden>
        {CREW.map((person) => (
          <PersonChip key={person.name} name={person.name} avatar={person.avatar} color={person.color} size="md" ring className="-mr-1.5" />
        ))}
      </span>
      <span className="text-sm">
        {OWNER!.name} is on <span>{plan}</span>. {NAMES.format(ALONG.map((person) => person.name))} come along.
      </span>
    </>
  );
}

// What a step adds, in decision 6's words, by the entitlement that grants it,
// and what the step pictures of it.
const ADDS: [entitlement: string, words: string, Picture: (props: { plan: string }) => ReactNode][] = [
  ["ai.ask", "Your personal AI trip assistant.", Assistant],
  ["trip.collaborators", "Bring the whole crew in. Only you need it.", Crew],
];

/** Decision 6's line for the plan that holds no other: no "free" in it, which only the plan's name may say (SPEC §14). */
const FIRST_STEP = "Every trip you want, as many days as you like — and share any of it with a link.";

/** A plan's name as the page says it, "Free" rather than its id: in the text itself, not by CSS, which a screen reader and a copy do not see. */
const planName = (choice: AccountPlanChoice) => choice.planId.charAt(0).toUpperCase() + choice.planId.slice(1);

/** What `choice` grants that `base` does not, in words and pictures; "More." for a grant nobody has written words for. */
function adds(choice: AccountPlanChoice, base: AccountPlanChoice) {
  const extra = choice.entitlements.filter((entitlement) => !base.entitlements.includes(entitlement));
  const known = ADDS.filter(([entitlement]) => extra.includes(entitlement));
  return {
    words: known.length === 0 ? "More." : known.map(([, words]) => words).join(" "),
    pictures: known.map(([entitlement, , Picture]) => <Picture key={entitlement} plan={planName(choice)} />),
  };
}

// The ladder's steps by their place on it, not by plan: a paper step, then
// ink, then the brand, each taller than the one before (the prototype's
// `.s0`, `.s1`, `.s2`). The ladder sizes them (`.landing-ladder`): each
// fills it to its foot, the last full height, the others a rise lower.
const STEP = ["border border-hairline bg-surface text-ink", "bg-mat-ladder text-person-on", "bg-brand text-person-on"];
const STEP_MARK = ["", "bg-surface/15", "bg-surface/15"];

/**
 * The front door's pricing: a ladder of the plans with each one's name, its
 * price from the snapshot of the live plan file, and its step: *"Everything
 * in Free, and…"* (M51 decision 6), laid as the C2 prototype lays it. Not
 * pedantic: the specifics are `/plans`' comparison table, one link away
 * (Mitchell, 2026-10-11: *"the specifics are for the actual payment page"*).
 *
 * Shared by the desktop landing and the phone front door. It fills the room
 * it is given: on the sea, a cell's; on a phone, the steps stack and take
 * their own height. Each plan's name is its own element, so the copy rule's
 * exemption for it (SPEC §17.1) covers the name inside a line too.
 */
export function LandingPricing({ id, ref }: { id?: string; ref?: Ref<HTMLElement> }) {
  const steps = ladder(LANDING_PLANS);
  return (
    <section id={id} ref={ref} aria-label="Pricing" className="landing-pricing flex min-h-0 flex-1 flex-col gap-4 md:grid">
      <div className="flex min-h-0 flex-1 flex-col gap-4 md:contents" data-testid="plan-summary">
        <DataText size="xs" className="text-2xs tracking-widest uppercase">
          Pricing ·{" "}
          {steps.map(({ choice }, i) => (
            <Fragment key={choice.planId}>
              {i > 0 && " → "}
              <span>{planName(choice)}</span>
            </Fragment>
          ))}
        </DataText>
        <Heading level={2} className="text-2xl text-pretty">
          Start on <span>{planName(steps[0]!.choice)}</span>. Add more when you want it.
        </Heading>
        <div data-testid="plan-ladder" className="landing-ladder grid min-h-0 flex-1 grid-cols-1 gap-3.5 md:grid-cols-3">
          {steps.map(({ choice, base }, i) => {
            const step = base === null ? null : adds(choice, base);
            return (
              <div
                key={choice.planId}
                className={cn("flex min-w-0 flex-col gap-3 overflow-hidden rounded-xl p-5.5", STEP[Math.min(i, STEP.length - 1)])}
              >
                <span className="font-mono text-xs tracking-widest uppercase">{planName(choice)}</span>
                <span className="font-display text-3xl leading-none font-bold">
                  {choice.priceMinor === null ? "—" : formatPrice(choice.priceMinor, choice.currency)}
                  {(choice.priceMinor ?? 0) > 0 && <span className="ml-1 font-sans text-sm font-normal"> / month</span>}
                </span>
                {step === null ? (
                  <span className="text-md">{FIRST_STEP}</span>
                ) : (
                  <>
                    <span
                      data-testid="plan-step"
                      className={cn("self-start rounded-full px-2.5 py-1 font-mono text-2xs tracking-wider uppercase", STEP_MARK[Math.min(i, STEP_MARK.length - 1)])}
                    >
                      <span aria-hidden>+ </span>Everything in <span>{planName(base!)}</span>, and
                    </span>
                    <span className="text-md" data-testid="plan-adds">
                      {step.words}
                    </span>
                    {step.pictures}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {/* `/plans` is a signed-in route: opened signed out it cannot load a
          plan and says so. Through sign-in, as the proxy sends every other
          signed-out visitor to an account route. */}
      <Link
        href={`/signin?callbackUrl=${encodeURIComponent("/plans")}`}
        className={cn(buttonVariants({ variant: "secondary", size: "sm" }), PHONE_TOUCH, "self-start no-underline md:self-end")}
      >
        Compare plans
      </Link>
    </section>
  );
}
