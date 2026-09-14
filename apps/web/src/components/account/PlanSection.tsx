"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Heading } from "@/components/ui/heading";
import { Preview } from "@/components/ui/preview";
import { Text } from "@/components/ui/text";
import type { AccountPlanView } from "@/lib/accountPlan";

// **The Plan section the design puts at the top of Account settings**
// (handoff `SPEC.md` §17.4). Mitchell, 2026-09-14: *"Users right now cant
// change there tier"* — and before this there was no plan surface at all, so
// everything M20 built was invisible to the person holding it.
//
// **Three quarters of this is real and one quarter is a shell**, which is the
// M20/M21 line drawn through one screen:
//
//   * **What you hold** — plan, version and capabilities, resolved per request
//     from the database. Real.
//   * **Assistant use today** — two meters against the ceilings actually in
//     force (the resolver's most-generous union, which is what `/ask` charges
//     against), read without charging them. Real, and the display half of
//     link 5's two-ceiling gate box.
//   * **Your referral code** — link 8 minted codes server-side and shipped no
//     way to get one, which is the exact defect that link exists to remove
//     (*"codes are minted by hand, so nobody could earn a referral they could
//     not issue"*). Real, through `/api/account/referrals`.
//   * **Changing plan** — drawn from the same committed plan file the operator
//     console's tier panel reads, and wrapped in `<Preview>`, because paying
//     needs Stripe and Stripe is M21 link 7. The shapes are real; the payment
//     is not.
//
// **There is no price anywhere on this screen, and that is not an oversight.**
// M20 never learns what a plan costs — the plan file has no price field to
// read. The design shows `$0 / $8 / $16`; those arrive with the subscription
// that justifies them. A plan is described here by what it GRANTS, which is
// the thing M20 actually knows and the thing `can()` actually asks about.

/**
 * A quota meter. **Deliberately not `BudgetMeter`**, which takes
 * `{ cost, budget, currency }` and is about money — questions and steps are
 * counts, and borrowing a currency-shaped component to show them is the same
 * category error as storing this milestone's costs in `Money` (ADR-008, KI-1).
 * It is a few lines; the semantics are the reason.
 */
function Meter({ label, standing, testId }: { label: string; standing: { used: number; limit: number }; testId: string }) {
  const pct = standing.limit > 0 ? Math.min(100, (standing.used / standing.limit) * 100) : 0;
  return (
    <div className="flex flex-col gap-1" data-testid={testId}>
      <div className="flex items-baseline justify-between gap-2">
        <Text as="span" className="text-sm text-ink">
          {label}
        </Text>
        <Text as="span" className="text-sm text-ink">
          {standing.used} / {standing.limit}
        </Text>
      </div>
      {/* `aria-hidden`: the numbers above are the accessible value, and a
          progress bar repeating them adds noise rather than information. */}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-moss" aria-hidden>
        {/* eslint-disable-next-line no-restricted-syntax -- a fill width is computed
            from data and has no token; the same enumerated exception Board and
            Sparkline take for geometry (design-system.md). */}
        <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function describe(choice: AccountPlanView["catalogue"][number]): string {
  if (choice.entitlements.length === 0) {
    return "Days, stops, map, costs, saved days. No assistant, no one else on the trip.";
  }
  const limits =
    choice.perUserRequestsPerDay === null
      ? ""
      : ` ${choice.perUserRequestsPerDay} questions a day.`;
  return `${choice.entitlements.join(", ")}.${limits}`;
}

export function PlanSection() {
  const [plan, setPlan] = useState<AccountPlanView | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    void fetch("/api/account/plan")
      .then((res) => (res.ok ? (res.json() as Promise<{ plan: AccountPlanView }>) : null))
      .then((body) => {
        if (!live) return;
        if (body === null) setFailed(true);
        else setPlan(body.plan);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  async function mintCode() {
    const res = await fetch("/api/account/referrals", { method: "POST" });
    if (!res.ok) return;
    const body = (await res.json()) as { code: string };
    setPlan((current) => (current === null ? current : { ...current, referralCode: body.code }));
  }

  if (failed) {
    return (
      <Text variant="secondary" className="text-sm">
        Your plan could not be loaded just now.
      </Text>
    );
  }
  if (plan === null) return null;

  const [planId, version] = plan.planVersionRef.split("@");

  return (
    <section className="flex flex-col gap-3" aria-labelledby="plan-heading" data-testid="plan-section">
      <Heading level={3} id="plan-heading">
        Plan
      </Heading>

      <div className="flex flex-col gap-1 rounded-lg border border-hairline p-3">
        <Text as="span" className="text-sm font-semibold text-ink" data-testid="plan-held">
          {planId} {version}
        </Text>
        <Text variant="secondary" className="text-xs">
          {plan.entitlements.length === 0
            ? "Planning only — the assistant and collaborators are not on this plan."
            : `You can: ${plan.entitlements.join(", ")}.`}
        </Text>
        {/* Payment lives in M21. The shell keeps the design's two actions
            visible and inert rather than pretending they are missing. */}
        <Preview id="account-plan-billing" size="compact" className="mt-1 self-start">
          <Button variant="secondary" size="sm">
            Payment and invoices
          </Button>
        </Preview>
      </div>

      {/* **The meters.** Ceilings come from the PINNED version — the one this
          account holds — and the environment's global ceiling is deliberately
          never shown, because it was never sold to anyone. */}
      <div className="flex flex-col gap-2 rounded-lg border border-hairline p-3">
        <Heading level={4}>Assistant use today</Heading>
        <Meter label="Questions" standing={plan.questions} testId="meter-questions" />
        <Text variant="secondary" className="text-xs">
          Every question you ask the assistant, across all your trips.
        </Text>
        <Meter label="Steps" standing={plan.steps} testId="meter-steps" />
        <Text variant="secondary" className="text-xs">
          One question can take several steps. On a heavy day this is the one that runs out first.
        </Text>
        {/* The design's line here is "Both ceilings come from premium v2 — the
            version you bought", which is only true when no grant is in play.
            An account on `free` with a `plus` trial is enforced at the trial's
            ceilings, so naming the held version would contradict the meter
            directly above it. */}
        <Text variant="secondary" className="text-xs">
          {plan.entitlements.length === 0
            ? `From ${planId} ${version}, the version you hold.`
            : `The most generous of ${planId} ${version} and anything granted to you — the same ceilings the assistant enforces.`}
        </Text>
      </div>

      {/* **Link 8's missing half.** The server could mint codes and nothing
          could ask it to. */}
      <div className="flex flex-col gap-2 rounded-lg border border-hairline p-3">
        <Heading level={4}>Bring someone in, get a month</Heading>
        <Text variant="secondary" className="text-xs">
          When someone new signs up with your code you get a month of whatever you hold the moment
          they join. A free plan earns nothing, so there is nothing to farm.
        </Text>
        {plan.referralCode === null ? (
          <Button variant="secondary" size="sm" onClick={() => void mintCode()} className="self-start">
            Create a code
          </Button>
        ) : (
          <div className="flex items-center gap-2">
            <Text as="span" className="rounded-sm bg-moss px-2 py-1 text-sm text-ink" data-testid="referral-code">
              {plan.referralCode}
            </Text>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(plan.referralCode ?? "");
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        )}
      </div>

      {/* **The chooser: real plans, no prices, no payment.** */}
      <Preview id="account-plan-change" size="container" note="Paying for a plan arrives in M21">
        <div className="flex flex-col gap-2" data-testid="plan-chooser">
          {plan.catalogue.map((choice) => (
            <div
              key={choice.planId}
              className="flex items-start justify-between gap-3 rounded-lg border border-hairline p-3"
              data-testid={`plan-choice-${choice.planId}`}
            >
              <div className="flex flex-col">
                <Text as="span" className="text-sm font-semibold text-ink">
                  {choice.planId}
                </Text>
                <Text variant="secondary" className="text-xs">
                  {describe(choice)}
                </Text>
              </div>
              {choice.held ? (
                <Text as="span" className="text-xs text-slate">
                  What you hold
                </Text>
              ) : (
                <Button variant="secondary" size="sm">
                  Pick {choice.planId}
                </Button>
              )}
            </div>
          ))}
          <Text variant="secondary" className="text-xs">
            Payment happens on Stripe, not here. Nothing about your account changes until the
            payment clears.
          </Text>
        </div>
      </Preview>
    </section>
  );
}
