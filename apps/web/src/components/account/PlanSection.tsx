"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Heading } from "@/components/ui/heading";
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { effectiveTierRef, type AccountPlanView } from "@/lib/accountPlan";
import { Check } from "lucide-react";
import {
  ENTITLEMENT_LABEL,
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

/**
 * **The Plan tab while `/api/account/plan` is in flight** (Mitchell, Vercel
 * Toolbar on `/account?tab=plan`: *"This page has no skeleton mode, and its
 * mostly static text, we can put more of the text with placeholders for when
 * the data loads in"*). It rendered nothing, so the whole tab appeared at once.
 *
 * The section's own two cards, with everything that does not depend on the
 * account written out for real — the first capability (every plan has it),
 * *Change plan* (a real link, §3b: chrome is never placeholdered), the meters'
 * heading, labels and explanations — and a bone only where a value goes: the
 * tier and its state, the renewal line, the rest of the capability list, the
 * counts, and the ceilings line. Meter tracks are drawn empty, never filled.
 * The past-due banner and the referral row depend on the account and are not
 * guessed at.
 */
function PlanSectionSkeleton() {
  const meter = (label: string, testId: string) => (
    <div className="flex flex-col gap-1" data-testid={testId}>
      <div className="flex items-baseline justify-between gap-2">
        <Text as="span" className="text-sm text-ink">
          {label}
        </Text>
        <span className="block text-sm">
          <Skeleton circle className="inline-block h-3 w-12 align-middle" delay={2} />
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-moss" aria-hidden />
    </div>
  );
  return (
    <SkeletonRegion label="Loading your plan" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5 rounded-lg border border-hairline bg-surface p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="block text-sm">
            <Skeleton className="inline-block h-3.5 w-24 align-middle" />
          </span>
          <Skeleton circle className="h-5 w-16" />
        </div>
        <span className="block text-xs">
          <Skeleton circle className="inline-block h-2.5 w-40 align-middle" delay={2} />
        </span>
        <ul className="mt-1 flex flex-col gap-1">
          <li className="flex items-start gap-2 text-xs text-ink">
            <Check aria-hidden className="mt-px size-3.5 shrink-0 text-success" />
            Plan trips, days and stops, with the map and costs
          </li>
          {["w-48", "w-40"].map((width) => (
            <li key={width} className="flex items-start gap-2 text-xs">
              <span aria-hidden className="mt-px size-3.5 shrink-0" />
              <Skeleton circle className={`mt-0.5 inline-block h-2.5 align-middle ${width}`} delay={2} />
            </li>
          ))}
        </ul>
        <div className="mt-1 flex flex-wrap gap-2">
          <Link href="/plans" className={buttonVariants({ variant: "secondary", size: "sm" })}>
            Change plan
          </Link>
        </div>
      </div>
      <div className="flex flex-col gap-2 rounded-lg border border-hairline bg-surface p-3">
        <Heading level={4}>Assistant use today</Heading>
        {meter("Questions", "meter-questions-skeleton")}
        <Text variant="secondary" className="text-xs">
          Every question you ask the assistant, across all your trips.
        </Text>
        {meter("Steps", "meter-steps-skeleton")}
        <Text variant="secondary" className="text-xs">
          One question can take several steps. On a heavy day this is the one that runs out first.
        </Text>
        <span className="block text-xs">
          <Skeleton circle className="inline-block h-2.5 w-3/4 align-middle" delay={3} />
        </span>
      </div>
    </SkeletonRegion>
  );
}

/** The signup URL that arrives with `code` already in the invite-code field. */
function referralLink(code: string): string {
  return `${window.location.origin}/signup?code=${encodeURIComponent(code)}`;
}

/**
 * **This took an `onNavigate` prop until M26 link 1, and it is gone.**
 *
 * It existed solely to close the account Sheet: the Sheet was a modal dialog
 * and `Change plan` is a real navigation out of it (SPEC §29), so without it
 * the route changed underneath a dialog that stayed open over the page it had
 * just navigated to (preview, 2026-09-15: *"Clicking change plan should
 * navigate to the plans, but also close the sidebar"*). Account is a route now
 * (§34.4) and there is nothing to close — a navigation is just a navigation.
 * The defect it fixed cannot recur, because the container it was about no
 * longer exists.
 *
 * Otherwise this component **moved unchanged**: it still self-fetches rather
 * than taking props, because it was mounted from the header on every route and
 * threading a plan through every one of them would make an unrelated surface
 * care about entitlements.
 */
export function PlanSection() {
  const [plan, setPlan] = useState<AccountPlanView | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [openingPortal, setOpeningPortal] = useState(false);

  useEffect(() => {
    let live = true;
    // eslint-disable-next-line no-restricted-globals -- an app API call with no client helper yet; moves onto the client with the collapse still open in KI-2026-09-05-q
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
    // eslint-disable-next-line no-restricted-globals -- an app API call with no client helper yet; moves onto the client with the collapse still open in KI-2026-09-05-q
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
      // eslint-disable-next-line no-restricted-globals -- an app API call with no client helper yet; moves onto the client with the collapse still open in KI-2026-09-05-q
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
  if (plan === null) return <PlanSectionSkeleton />;

  const [planId, version] = plan.planVersionRef.split("@");
  // **The tier this account can actually use, which is not always the one it
  // bought.** Mitchell, 2026-09-19: a founding account read `plus v1` while two
  // permanent `premium` grants sat active on it, so this screen never once said
  // the word for what the account could do. `entitlements` below was already
  // right — it is the union — but a list of capability strings is not a tier a
  // person recognises, and both tier fields on the wire are about the
  // subscription. See `effectiveTierRef` for why choosing between them happens
  // here, in rendering, and nowhere upstream.
  const effectiveRef = effectiveTierRef(plan);
  const [effectivePlanId, effectiveVersion] = effectiveRef.split("@");
  const grantedAbove = effectiveRef !== plan.conferredVersionRef;
  const { billing } = plan;
  // **What a lapse would take from other people — asked of the SERVER, which
  // is the only place that can answer it** (CodeRabbit, PR #177).
  //
  // This is the half of the copy nobody else can say. M20's collaborator cap is
  // applied on read, so the owner's guests drop to `viewer` the moment this
  // account stops holding `trip.collaborators` — and they are never told,
  // because it is not their account. Naming it here is the only warning there
  // is, which is exactly why naming it WRONGLY is expensive.
  //
  // Two earlier versions were each false in one direction, and neither was
  // conservative:
  //
  //   * `plan.entitlements`, the effective set, includes whatever a grant
  //     supplies — so before a lapse it named losses a founder grant would
  //     prevent, and after one it no longer mentioned collaborators at all, so
  //     the banner explaining that loss went quiet exactly when it mattered.
  //   * The HELD plan's own list fixed the second half and kept the first:
  //     blind to grants, it tells a lapsed founder their collaborators went
  //     read-only when the grant means they did not. On this deployment that
  //     is the common case, since every account predating M20's migration
  //     carries such a grant.
  //
  // `billing.losesOnLapse` is the difference of the two unions — what
  // `[held, ...grants]` confers minus what `[free, ...grants]` does — computed
  // by `entitlementsLostIfSubscriptionStops`. It is the same answer before and
  // after the lapse, which is what lets one value serve both banners.
  const losesCollaborators = billing.losesOnLapse.includes("trip.collaborators");
  const renews = formatDate(billing.renewsAt);
  const trialEnds = formatDate(billing.trialEndsAt);
  const trialEndShown = billing.state === "trial" && trialEnds !== null;
  // **When the tier on the card stops, if a grant is what confers it** — the
  // grant behind `effectiveRef`, and of several for that same tier the one
  // that lasts longest (a permanent one wins). `undefined` when no grant is
  // above the bought plan: then the subscription's own renewal line is the
  // answer.
  const effectiveGrant = grantedAbove
    ? plan.grants
        .filter((g) => `${g.planId}@v${g.version}` === effectiveRef)
        .sort((a, b) => (a.expiresAt === null ? -1 : b.expiresAt === null ? 1 : b.expiresAt.localeCompare(a.expiresAt)))[0]
    : undefined;
  const grantEnds = effectiveGrant?.expiresAt != null ? formatDate(effectiveGrant.expiresAt) : null;
  // **What the account is on once that grant ends — worked out, not assumed**
  // (CodeRabbit, PR #269). It used to say "then back to" the bought plan, which
  // is wrong whenever another grant outlasts this one: a free account holding a
  // premium comp to December and a permanent founder plus drops to plus, not
  // free. The grants still active after this one's end, ranked the same way
  // `effectiveTierRef` ranks them now.
  const expiresAt = effectiveGrant?.expiresAt ?? null;
  const fallbackRef =
    expiresAt === null
      ? null
      : effectiveTierRef({
          ...plan,
          grantedVersionRefs: plan.grants
            .filter((g) => g !== effectiveGrant && (g.expiresAt === null || g.expiresAt > expiresAt))
            .map((g) => `${g.planId}@v${g.version}`),
        });
  const capabilities = plan.entitlements.map(
    (entitlement) => ENTITLEMENT_LABEL[entitlement as keyof typeof ENTITLEMENT_LABEL] ?? entitlement,
  );

  return (
    // **No `<Heading>Plan</Heading>` and no `aria-labelledby` pointing at one.**
    // The tab above says "Plan & usage" and the tab panel does the labelling
    // (§34.4) — keeping both would be project rule 4 twice on one screen. The
    // `<section>` stays for the testid and the grouping; it takes its
    // accessible name from the panel that wraps it.
    <section className="flex flex-col gap-3" data-testid="plan-section">

      {/* §34.5: **every box on the page is `--color-surface` — no exceptions.**
          This card, the meters and the referral row shipped unfilled and read
          as holes in the column beside the filled ones. A box that groups
          things is a card; a card is white. */}
      <div className="flex flex-col gap-1.5 rounded-lg border border-hairline bg-surface p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Text as="span" className="text-sm font-semibold text-ink" data-testid="plan-effective">
            {effectivePlanId} {effectiveVersion}
          </Text>
          <Badge variant={PLAN_STATE_BADGE[billing.state]} data-testid="plan-state">
            {PLAN_STATE_LABEL[billing.state]}
          </Badge>
        </div>
        {/* **Three questions, in this order: what tier, until when, and what it
            lets me do** (Mitchell, PR #269 preview: *"This square should just
            be Whats my current tier, when does my account renew (or expire
            back to free), and what is my capabilities at this tier"*). The
            tier is the row above. The "You bought … ; a grant confers …" line
            and the per-grant "Granted to you: …" line are gone "for now" in
            the same comment — they answered KI-20260916-b's "which grants,
            and why", which billing history is the better home for later. */}
        {/* **The renewal sentence changes with the state rather than being one
            line with a date in it.** "Renews on 20 October" and "ends on 20
            October" are the same date and opposite facts, and a person deciding
            whether to fix a card is reading for exactly that difference.

            A free week has an end date and no renewal date, because a trial
            is a grant rather than a subscription period. A tier conferred by
            any other grant says when that grant ends and what the account goes
            back to — the bought plan — or that it does not end. */}
        {trialEndShown ? (
          <Text variant="secondary" className="text-xs" data-testid="plan-trial-ends">
            Your free week runs to {trialEnds}. After that this account is on {planId} {version}
            {" "}unless you choose a plan.
          </Text>
        ) : effectiveGrant !== undefined ? (
          <Text variant="secondary" className="text-xs" data-testid="plan-expires">
            {grantEnds === null
              ? "This doesn't expire."
              : `Until ${grantEnds}, then ${fallbackRef?.split("@").join(" ") ?? `${planId} ${version}`}.`}
          </Text>
        ) : null}
        {!trialEndShown && renews !== null ? (
          <Text variant="secondary" className="text-xs" data-testid="plan-renews">
            {billing.state === "cancelling"
              ? `Ends on ${renews}. Until then nothing changes.`
              : `Renews on ${renews}.`}
          </Text>
        ) : null}

        {/* **What this tier lets you do, one line each** (Mitchell, PR #269
            preview: "rather than a comma seperated string"). The raw
            entitlement keys, comma-joined, are gone; each is named in
            `ENTITLEMENT_LABEL`'s words. Planning itself is on every plan, so
            it heads the list and the list is never empty. */}
        <ul className="mt-1 flex flex-col gap-1" aria-label="What you can do" data-testid="plan-capabilities">
          {["Plan trips, days and stops, with the map and costs", ...capabilities].map((capability) => (
            <li key={capability} className="flex items-start gap-2 text-xs text-ink">
              <Check aria-hidden className="mt-px size-3.5 shrink-0 text-success" />
              {capability}
            </li>
          ))}
        </ul>

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
      <div className="flex flex-col gap-2 rounded-lg border border-hairline bg-surface p-3">
        {/* h2, not h4: the Plan panel is named by its tab and has no heading
            of its own, so these cards sit straight under the page's h1 and an
            h4 skipped two levels (axe heading-order). Same h4 type. */}
        <Heading level={2} className="text-md font-medium">Assistant use today</Heading>
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
        <div className="flex flex-col gap-2 rounded-lg border border-hairline bg-surface p-3" data-testid="referral-row">
          <Heading level={2} className="text-md font-medium">Bring someone in, get a month</Heading>
          <Text variant="secondary" className="text-xs">
            When someone new signs up with your link you get a month of whatever you hold the moment
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
                  // The link, not the bare code: `/signup?code=` prefills the
                  // field, so the person invited never has to type it.
                  navigator.clipboard
                    .writeText(referralLink(plan.referralCode ?? ""))
                    .then(() => setCopied(true))
                    .catch(() => setCopied(false));
                }}
              >
                {copied ? "Copied" : "Copy invite link"}
              </Button>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
