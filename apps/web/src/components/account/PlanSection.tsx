"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Heading } from "@/components/ui/heading";
import { Text } from "@/components/ui/text";
import type { AccountPlanView } from "@/lib/accountPlan";
import {
  PLAN_STATE_BADGE,
  PLAN_STATE_LABEL,
  formatDate,
  lapsedSentence,
  pastDueSentence,
} from "@/lib/planCopy";

// **The Plan section the design puts at the top of Account settings**
// (handoff `SPEC.md` §17.4, amended by §29).
//
// **All of it is real now.** M20 shipped this screen with its chooser and its
// billing button wrapped in `<Preview>`, because paying needed Stripe; M21 link
// 5 supplies the customer and the session, and both shells are gone from
// `preview-registry.ts`.
//
// **The chooser left the sheet** — SPEC §29, which supersedes §17.4's last
// bullet. Two reasons, in the design's order of weight: the inline version had
// no room to answer the question being asked (a person arriving here wants to
// know what the upper tiers are *for*, and three rows inside a sheet gave each
// plan a price and one line), and it grew the page under the pointer — expanding
// between the plan card and the meters pushed the meters, the past-due banner
// and the referral row down. Nothing was wrong with the copy; the reflow was the
// defect. `Change plan` is now a link to the `plans` route.
//
// **§29's own framing is the rule this file follows**: *"Plans is not a second
// view of the same information."* The sheet keeps plan, version, state, the two
// meters, past-due and referral. The route holds what the sheet never had —
// what each plan grants, side by side, and the order. Nothing appears twice.
//
// **The past-due copy names the loss rather than announcing one.** That is link
// 6 expressed as words, and it is the strongest form of it: the decline date,
// the date the window ends, and what stops then, including the collaborators
// dropping to read-only. With three days there is no room for a gentle first
// notice followed by a firm one, so this is the firm one.

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

export function PlanSection() {
  const [plan, setPlan] = useState<AccountPlanView | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [openingPortal, setOpeningPortal] = useState(false);

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

  /**
   * **Stripe's portal, opened by asking the server for a session.**
   *
   * A portal URL is single-use and short-lived, so it cannot be an `href`
   * rendered with the page — it has to be minted at the moment of the click.
   * The button therefore does work before it navigates, and says so while it
   * does: a control that looks inert for a round trip gets clicked twice.
   */
  async function openPortal() {
    setOpeningPortal(true);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      if (!res.ok) {
        setOpeningPortal(false);
        return;
      }
      const body = (await res.json()) as { url: string };
      window.location.assign(body.url);
    } catch {
      setOpeningPortal(false);
    }
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
  const { billing } = plan;
  // **What a lapse would take from other people**, which is the half of the
  // copy nobody else can say. M20's collaborator cap is applied on read, so the
  // owner's guests drop to `viewer` the moment this account stops holding
  // `trip.collaborators` — and they are never told, because it is not their
  // account. Naming it here is the only warning that exists.
  // **What a lapse would take from other people — read off the plan the
  // account PAYS FOR, not off its current effective set.**
  //
  // `plan.entitlements` is the resolved union, and it was wrong in both
  // directions. Before a lapse it includes whatever a grant supplies, so the
  // warning could name a loss that a founder grant would prevent. After one it
  // no longer includes collaborators at all, so the lapsed banner — the one
  // that exists to say what just went — stopped naming it.
  //
  // The held version is the honest source: it is what the subscription buys and
  // therefore what stopping it takes. Where a grant also covers it the warning
  // is conservative rather than wrong, which is the right direction for a
  // sentence about other people losing access. CodeRabbit, PR #177.
  const heldPlan = plan.catalogue.find((choice) => choice.planId === planId);
  const losesCollaborators = (heldPlan?.entitlements ?? plan.entitlements).includes(
    "trip.collaborators",
  );
  const renews = formatDate(billing.renewsAt);
  const trialEnds = formatDate(billing.trialEndsAt);

  return (
    <section className="flex flex-col gap-3" aria-labelledby="plan-heading" data-testid="plan-section">
      <Heading level={3} id="plan-heading">
        Plan
      </Heading>

      <div className="flex flex-col gap-1.5 rounded-lg border border-hairline p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Text as="span" className="text-sm font-semibold text-ink" data-testid="plan-held">
            {planId} {version}
          </Text>
          <Badge variant={PLAN_STATE_BADGE[billing.state]} data-testid="plan-state">
            {PLAN_STATE_LABEL[billing.state]}
          </Badge>
        </div>
        <Text variant="secondary" className="text-xs">
          {plan.entitlements.length === 0
            ? "Planning only — the assistant and collaborators are not on this plan."
            : `You can: ${plan.entitlements.join(", ")}.`}
        </Text>
        {/* **The renewal sentence changes with the state rather than being one
            line with a date in it.** "Renews on 20 October" and "ends on 20
            October" are the same date and opposite facts, and a person deciding
            whether to fix a card is reading for exactly that difference. */}
        {/* **A free week has an end date and no renewal date**, because a trial
            is a grant rather than a subscription period — so `renewsAt` is null
            for the one state every brand-new account is in, and this line was
            simply absent there. A browser walk of the preview found the badge
            saying *Free week* with nothing anywhere saying when the week ended
            or what happened then. */}
        {billing.state === "trial" && trialEnds !== null ? (
          <Text variant="secondary" className="text-xs" data-testid="plan-trial-ends">
            Your free week runs to {trialEnds}. After that this account is on {planId} {version}
            {" "}unless you choose a plan.
          </Text>
        ) : renews !== null ? (
          <Text variant="secondary" className="text-xs" data-testid="plan-renews">
            {billing.state === "cancelling"
              ? `Ends on ${renews}. Until then nothing changes.`
              : `Renews on ${renews}.`}
          </Text>
        ) : null}

        <div className="mt-1 flex flex-wrap gap-2">
          {/* **A link, not a chooser** (SPEC §29). The sheet lost its expanding
              region because growing the page under the pointer pushed the
              meters, the banner and the referral row down — the reflow was the
              defect, not the copy. */}
          {/* `buttonVariants` on a `Link` rather than a `Button` wrapping one:
              this navigates, so it has to BE an anchor — the repo's existing
              pattern for that is `TripBoardScreen:345`, not an `asChild` prop
              `Button` does not have. */}
          <Link
            href="/plans"
            className={buttonVariants({ variant: "secondary", size: "sm" })}
            data-testid="plan-change-link"
          >
            Change plan
          </Link>
          {/* **Only when a checkout could succeed.** A deployment with no
              Stripe keys is legitimate — every local run and every CI run is
              one — and §29's rule is not to offer a CTA that opens a checkout
              which cannot succeed. */}
          {billing.available && billing.state !== "none" ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void openPortal()}
              disabled={openingPortal}
              data-testid="plan-billing-portal"
            >
              {openingPortal ? "Opening Stripe…" : "Payment and invoices"}
            </Button>
          ) : null}
        </div>
      </div>

      {/* **Past due is told before anything is taken** (§17.4, M21 link 6).
          The decline date, the date the window ends, and what stops then. */}
      {billing.state === "past-due" ? (
        <Banner
          variant="warning"
          data-testid="plan-past-due"
          actions={
            billing.available ? (
              <Button variant="secondary" size="sm" onClick={() => void openPortal()}>
                Fix card
              </Button>
            ) : undefined
          }
        >
          {pastDueSentence({
            declinedAt: billing.pastDueSince,
            graceEndsAt: billing.graceEndsAt,
            losesCollaborators,
          })}
        </Banner>
      ) : null}

      {billing.state === "lapsed" ? (
        <Banner variant="danger" data-testid="plan-lapsed">
          {lapsedSentence(losesCollaborators)}
        </Banner>
      ) : null}

      {/* **The meters.** Ceilings come from the resolver's answer — the most
          generous of the held version and anything granted — and the
          environment's global ceiling is deliberately never shown, because it
          was never sold to anyone. */}
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

      {/* **Link 8's missing half, and M21's rule about who sees it.**
          *"A `free` or trial-only account has no referral row at all, because
          it earns nothing"* — a referral pays a month of the tier you already
          hold, so offering one to an account holding nothing is offering a
          reward that resolves to zero. */}
      {plan.canRefer ? (
        <div className="flex flex-col gap-2 rounded-lg border border-hairline p-3" data-testid="referral-row">
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
                // **"Copied" only after the write resolves.** `writeText` rejects
                // on a denied permission or an unavailable clipboard API, and the
                // old `void` + immediate `setCopied(true)` told the operator their
                // code was on the clipboard when it was not — on the one control
                // whose entire job is to put it there. CodeRabbit, PR #174.
                onClick={() => {
                  navigator.clipboard
                    .writeText(plan.referralCode ?? "")
                    .then(() => setCopied(true))
                    .catch(() => setCopied(false));
                }}
              >
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
