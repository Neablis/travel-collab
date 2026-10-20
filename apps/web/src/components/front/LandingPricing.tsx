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

/** The assistant at work, as the step that adds it pictures it (the prototype's `.bub`). */
function Assistant(): ReactNode {
  return (
    <div className="flex flex-col gap-2 text-sm">
      <span className="ml-6 self-end rounded-lg bg-surface/15 px-2.5 py-2">Fill day 9 in Kyoto with something slow.</span>
      <span className="mr-6 rounded-lg bg-surface px-2.5 py-2 text-ink">
        Philosopher’s Path in the morning, then tea at Ippodo. Add to Day 9?
      </span>
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
// `.s0`, `.s1`, `.s2`). The heights are rows of the ladder's own grid, which
// the ladder sizes; a step fills what it is given.
const STEP = [
  "border border-hairline bg-surface text-ink md:row-start-3",
  "bg-mat-ladder text-person-on md:row-start-2",
  "bg-brand text-person-on md:row-start-1",
];
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
    <section id={id} ref={ref} aria-label="Pricing" className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex min-h-0 flex-1 flex-col gap-4" data-testid="plan-summary">
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
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3.5 md:grid-cols-3 md:grid-rows-6">
          {steps.map(({ choice, base }, i) => {
            const step = base === null ? null : adds(choice, base);
            return (
              <div
                key={choice.planId}
                className={cn("flex min-w-0 flex-col gap-3 overflow-hidden rounded-xl p-5.5 md:row-end-7", STEP[Math.min(i, STEP.length - 1)])}
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
        className={cn(buttonVariants({ variant: "secondary", size: "sm" }), PHONE_TOUCH, "self-start no-underline")}
      >
        Compare plans
      </Link>
    </section>
  );
}
