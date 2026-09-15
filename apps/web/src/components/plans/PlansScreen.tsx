"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Heading } from "@/components/ui/heading";
import { PageContainer } from "@/components/ui/page-container";
import { Text } from "@/components/ui/text";
import type { AccountPlanChoice, AccountPlanView } from "@/lib/accountPlan";
import { formatDate, formatPrice } from "@/lib/planCopy";
import { PlanComparison, planBullets, whoItIsFor } from "./PlanComparison";

// **The `plans` route: chooser, confirm, result — one route, no overlay in any
// of them** (SPEC §29).
//
// **Two states the design does not draw, and both are here because a build
// cannot skip them:**
//
//   1. **Return-from-Stripe-before-webhook.** §29 is explicit that the result
//      state it draws *"is faked in the design file — it is reached by a
//      click"*, and that in a build it is only reachable after the webhook has
//      written subscription state: *a redirect is a hint, never a grant*. So
//      coming back from Checkout lands on a **pending** state that re-reads the
//      account until the plan actually moves — **not a spinner that lies**, and
//      not a success message written from a URL.
//   2. **A stale plan version at pay time.** If a deploy publishes while
//      someone is on the confirm step, applying is refused with a conflict and
//      this re-renders the step with the new numbers and says so. Never charge
//      the old amount silently.
//
// **Every figure on the confirm step comes from Stripe's preview** of the
// change against the version being bought. Nothing here computes an amount from
// a price string: the only arithmetic in this file is `formatPrice`, which turns
// minor units into a string.

type Step =
  | { name: "chooser" }
  | { name: "confirm"; planId: string }
  /**
   * Waiting for the webhook — and `from` says WHY, because the two reasons
   * clear differently. See the reset effect for what depends on it.
   */
  | { name: "pending"; from: "checkout" | "change" }
  | { name: "result"; message: string };

/** What the confirm step renders, as the server sends it. */
interface PlanChangePreview {
  kind: "first-purchase" | "change" | "cancel";
  planId: string;
  planVersionRef: string;
  currency: string;
  lines: { description: string; minor: number; proration: boolean }[];
  dueTodayMinor: number;
  effectiveAt: string | null;
  cardOnFile: string | null;
}

/**
 * **How long to keep asking whether the webhook has landed.**
 *
 * Stripe's delivery is usually a second or two and is not guaranteed to be any
 * number of them. The alternative to a bound is a page that polls forever, and
 * the honest end of that is worse than a sentence saying it is taking longer
 * than expected — which is what this produces, rather than a spinner that goes
 * on implying something is about to happen.
 */
const PENDING_ATTEMPTS = 20;
const PENDING_INTERVAL_MS = 1500;

/**
 * What this account held in the instant before it left for Stripe.
 *
 * **Why a stash exists at all.** The pending screen decides success by
 * comparing against a baseline, and its only other source is the first
 * `/api/account/plan` read AFTER the return — which can lose a race to the
 * webhook and come back already reconciled. A baseline captured before the
 * redirect cannot lose that race, because at that moment the purchase had not
 * happened yet.
 *
 * **Keyed by the session id**, so a stale stash from an earlier, abandoned
 * checkout cannot be read as this one's baseline.
 *
 * `sessionStorage`, not `localStorage`: this is worth exactly one tab and one
 * browsing session, which is the lifetime of a checkout. Every access is
 * wrapped — Safari in private mode throws on access, not on write, and a
 * baseline that cannot be stored must degrade to the arrival read rather than
 * take the page down.
 */
const CHECKOUT_BASELINE_KEY = "plans:checkout-baseline";

interface CheckoutBaseline {
  session: string;
  /**
   * The plan version held before leaving. That is the whole baseline — there
   * is deliberately no `subscribed` flag beside it.
   *
   * It had one, and it was dead weight every red-first mutation proved: buying
   * a plan always MOVES the version ref, so whenever a stash exists `moved`
   * already decides the outcome and the flag never changed an answer. An
   * untested branch on a billing path is worse than no branch.
   */
  planVersionRef: string;
}

function stashCheckoutBaseline(baseline: CheckoutBaseline): void {
  try {
    window.sessionStorage.setItem(CHECKOUT_BASELINE_KEY, JSON.stringify(baseline));
  } catch {
    // No stash. `readCheckoutBaseline` returns null and the arrival read is
    // used instead — the behaviour this page had before the stash existed.
  }
}

function readCheckoutBaseline(session: string | null): CheckoutBaseline | null {
  if (session === null) return null;
  try {
    const raw = window.sessionStorage.getItem(CHECKOUT_BASELINE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<CheckoutBaseline>;
    // Every field checked rather than trusted: this is storage a page from any
    // earlier build may have written, and a malformed baseline that read as
    // `subscribed: undefined` would silently become `false`.
    if (parsed.session !== session || typeof parsed.planVersionRef !== "string") return null;
    return { session, planVersionRef: parsed.planVersionRef };
  } catch {
    return null;
  }
}

export function PlansScreen() {
  const params = useSearchParams();
  const checkout = params.get("checkout");
  const [plan, setPlan] = useState<AccountPlanView | null>(null);
  const [failed, setFailed] = useState(false);
  // **A returned session id, or nothing.** Stripe's Checkout Session ids are
  // `cs_` followed by an opaque token; anything else in this parameter is a
  // typed URL, a stale bookmark or someone poking, and none of those is a
  // return from a checkout. A browser walk of the preview found the cost of
  // not checking: `/plans?checkout=cs_test_forged` rendered a screen saying
  // *"Your payment has gone through"* on a deployment whose banner four inches
  // above said nothing could be bought. Shape alone is not proof — only the
  // webhook is — but it is what separates "came back from Stripe" from "typed
  // a URL", and the copy below no longer claims payment either way.
  const returnedSession = checkout !== null && /^cs_[A-Za-z0-9_]+$/.test(checkout) ? checkout : null;
  const [step, setStep] = useState<Step>(
    returnedSession === null ? { name: "chooser" } : { name: "pending", from: "checkout" },
  );
  // What the account held when this page loaded. The pending state needs it to
  // tell "the webhook landed" from "this account was already subscribed".
  //
  // **Written once and then never again** — `?? current` in the setter, so a
  // poll cannot overwrite the baseline it is being compared against.
  const [heldOnArrival, setHeldOnArrival] = useState<string | null>(null);
  // The same, for "was this account already paying". Write-once for the same
  // reason, and read by the pending effect so that the live `plan` object does
  // not have to be one of its dependencies.
  const [subscribedOnArrival, setSubscribedOnArrival] = useState<boolean | null>(null);
  const [preview, setPreview] = useState<PlanChangePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [slow, setSlow] = useState(false);

  const load = useCallback(async (): Promise<AccountPlanView | null> => {
    try {
      const res = await fetch("/api/account/plan");
      if (!res.ok) return null;
      const body = (await res.json()) as { plan: AccountPlanView };
      setPlan(body.plan);
      return body.plan;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    void load().then((loaded) => {
      if (loaded === null) setFailed(true);
      else {
        setHeldOnArrival((current) => current ?? loaded.planVersionRef);
        setSubscribedOnArrival((current) =>
          current ?? (loaded.billing.state !== "none" && loaded.billing.state !== "trial"),
        );
      }
    });
  }, [load]);

  // **"Back to plans" has to actually go back** (CodeRabbit, PR #177).
  //
  // It is a `Link` to `/plans` from `/plans?checkout=…` — the same route with
  // one parameter dropped — so the App Router navigates client-side and this
  // component does NOT remount. `step` is `useState`-initialised, so it stayed
  // on `pending` and the only way out of a stuck pending screen was a hard
  // reload. A link that changes the URL and nothing else is worse than no link.
  //
  // **Only the checkout-born pending resets.** The in-place plan change also
  // waits here and never had a `?checkout=` to lose, so keying this on the
  // parameter alone would have snapped it back to the chooser the instant it
  // started waiting — which is why `from` exists rather than a bare boolean.
  useEffect(() => {
    if (returnedSession === null && step.name === "pending" && step.from === "checkout") {
      setStep({ name: "chooser" });
      setSlow(false);
    }
  }, [returnedSession, step]);

  // **The pending state's only job: ask whether the webhook has landed yet.**
  useEffect(() => {
    if (step.name !== "pending") return;
    let attempts = 0;
    let live = true;
    // **The baseline is the one STASHED BEFORE LEAVING FOR STRIPE, and only
    // falls back to what this page first read** (CodeRabbit, PR #177).
    //
    // Reading the arrival state alone was a race. The webhook can land before
    // this page's first `/api/account/plan` returns — a fast webhook and a slow
    // first paint — and the baseline was then already the POST-purchase state.
    // Nothing could "move" from it and `wasSubscribed` came back true, so
    // neither test could ever fire and a completed first purchase sat on the
    // pending screen until the attempt ceiling.
    //
    // `stashedBaseline()` closes the window rather than narrowing it: it was
    // written while this page still knew the pre-checkout truth, one line
    // before the redirect. A visitor who did NOT come through that redirect —
    // a bookmarked or forged `?checkout=` URL — has no stash, and falls back to
    // the arrival read, which is what keeps `keeps waiting when an existing
    // subscriber's plan has not moved yet` true. Success is still evidence,
    // never the mere presence of a session id.
    const stashed = readCheckoutBaseline(returnedSession);
    // **Nothing is compared until the arrival read has landed — one rule, no
    // exception for the stash.** Found twice by red-first, and the second time
    // is the instructive one: an earlier version skipped this wait whenever a
    // stash existed, on the reasoning that the stash IS the baseline. It is
    // the baseline for `before`, but `wasSubscribed` still comes from the
    // arrival read, and `null` there read as "not subscribed" — the permissive
    // direction. A poll landing in that window called an existing subscriber's
    // unchanged plan a first purchase.
    //
    // Both values land together from the same load and both are dependencies,
    // so the effect re-arms the moment they do. Waiting costs one interval.
    if (heldOnArrival === null || subscribedOnArrival === null) return;
    const before = stashed?.planVersionRef ?? heldOnArrival;
    const wasSubscribed = subscribedOnArrival;
    const timer = setInterval(() => {
      if (!live) return;
      attempts += 1;
      void load().then((loaded) => {
        if (!live || loaded === null) return;
        // **Evidence that THIS checkout was reconciled, not merely that the
        // account is subscribed.** An account that already had a live
        // subscription satisfies "state is active" before its upgrade webhook
        // lands, so that test alone would declare success for a change that
        // has not happened. For an existing subscriber the held version must
        // MOVE; only a first purchase may use the transition into a paid
        // state, because for it there is nothing else to see.
        // CodeRabbit, PR #177.
        const moved = before !== null && loaded.planVersionRef !== before;
        const firstPurchase =
          !wasSubscribed &&
          (loaded.billing.state === "active" || loaded.billing.state === "cancelling");
        if (moved || firstPurchase) {
          clearInterval(timer);
          setStep({
            name: "result",
            message: "Your plan is active. Everything is live — no need to sign out.",
          });
        } else if (attempts >= PENDING_ATTEMPTS) {
          clearInterval(timer);
          setSlow(true);
        }
      });
    }, PENDING_INTERVAL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
    // **`subscribedOnArrival` rather than `plan`, and that is the other half of
    // the same bug** (CodeRabbit, PR #177). `load()` calls `setPlan()`, so
    // listing `plan` here re-ran this effect on every successful poll — tearing
    // the interval down and rebuilding it with `attempts` back at zero. The
    // ceiling was unreachable and `setSlow(true)` never fired, so a
    // reconciliation that never arrived left the page checking silently and
    // forever, with no "this is taking a while" and no way out.
    //
    // Both values this effect reads are now write-once (`heldOnArrival`,
    // `subscribedOnArrival`), so the dependency list is stable and there is no
    // stale closure traded for the fix.
  }, [step.name, load, heldOnArrival, subscribedOnArrival, returnedSession]);

  async function openConfirm(planId: string) {
    setStep({ name: "confirm", planId });
    setPreview(null);
    setPreviewError(null);
    setConflict(false);
    try {
      const res = await fetch(`/api/billing/change?planId=${encodeURIComponent(planId)}`);
      const body = (await res.json()) as { preview?: PlanChangePreview; message?: string };
      if (!res.ok) {
        setPreviewError(body.message ?? "This change could not be prepared just now.");
        return;
      }
      setPreview(body.preview ?? null);
    } catch {
      setPreviewError("This change could not be prepared just now.");
    }
  }

  async function confirm() {
    if (preview === null) return;
    setBusy(true);
    setConflict(false);
    try {
      const res = await fetch("/api/billing/change", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: preview.planId, shownVersionRef: preview.planVersionRef }),
      });
      const body = (await res.json()) as {
        kind?: string;
        url?: string;
        /** Present on a `checkout` answer — see `stashCheckoutBaseline`. */
        sessionId?: string;
        effectiveAt?: string | null;
        error?: string;
        message?: string;
      };
      if (res.status === 409 && body.error === "stale-version") {
        // **A conflict, not an error.** Re-preview so the person sees the new
        // numbers, and say so — never charge the old amount silently.
        setConflict(true);
        setBusy(false);
        await openConfirm(preview.planId);
        setConflict(true);
        return;
      }
      if (!res.ok) {
        setPreviewError(body.message ?? "This change could not be made just now.");
        setBusy(false);
        return;
      }
      if (body.kind === "checkout" && typeof body.url === "string") {
        // **The baseline is written here, while this page still knows the
        // pre-checkout truth.** One line later the browser is gone to Stripe,
        // and everything it can learn on the way back may already include the
        // purchase. `sessionId` comes from the same response that carries the
        // URL, so the stash is keyed to the session it describes.
        if (typeof body.sessionId === "string" && plan !== null) {
          stashCheckoutBaseline({ session: body.sessionId, planVersionRef: plan.planVersionRef });
        }
        window.location.assign(body.url);
        return;
      }
      if (body.kind === "cancelling") {
        const when = formatDate(body.effectiveAt ?? null);
        setStep({
          name: "result",
          message:
            when === null
              ? "Your plan will not renew. Nothing changes until the period you have paid for ends."
              : `Your plan ends on ${when}. Until then nothing changes.`,
        });
        setBusy(false);
        return;
      }
      // An in-place change: Stripe has taken it and the webhook writes the row.
      setStep({ name: "pending", from: "change" });
      setBusy(false);
    } catch {
      setPreviewError("This change could not be made just now.");
      setBusy(false);
    }
  }

  if (failed) {
    return (
      <PageContainer>
        <Banner variant="warning">Your plan could not be loaded just now.</Banner>
      </PageContainer>
    );
  }
  if (plan === null) return null;

  const held = plan.catalogue.find((choice) => choice.held) ?? null;

  return (
    <PageContainer>
      <div className="flex flex-col gap-5" data-testid="plans-screen">
        <div className="flex flex-col gap-1">
          <Heading level={1}>Plans</Heading>
          {/* **The held plan, stated once, at the top** (§29's chooser). Held
              plan, price, renewal date, and that a change now is prorated to
              the day. */}
          <Text variant="secondary" className="text-sm" data-testid="plans-held-line">
            {heldLine(plan, held)}
          </Text>
        </div>

        {/* **Offline / plan data unavailable** (§29): show the held plan and a
            warning, and do not offer a CTA that opens a checkout which cannot
            succeed. */}
        {!plan.billing.available ? (
          <Banner variant="warning" data-testid="plans-unavailable">
            Changing plan is not available on this deployment, so nothing here can be bought right
            now. What each plan grants is below and is accurate.
          </Banner>
        ) : null}

        {step.name === "chooser" ? (
          <Chooser
            plan={plan}
            onChoose={(planId) => void openConfirm(planId)}
            canBuy={plan.billing.available}
          />
        ) : null}

        {step.name === "confirm" ? (
          <Confirm
            plan={plan}
            preview={preview}
            error={previewError}
            conflict={conflict}
            busy={busy}
            onBack={() => setStep({ name: "chooser" })}
            onConfirm={() => void confirm()}
          />
        ) : null}

        {step.name === "pending" ? <Pending slow={slow} /> : null}

        {step.name === "result" ? (
          <div className="flex flex-col gap-3 rounded-lg border border-hairline p-4" data-testid="plans-result">
            <Heading level={2}>Done</Heading>
            <Text className="text-sm">{step.message}</Text>
            <Link href="/" className="text-sm text-brand underline">
              Back to your trips
            </Link>
          </div>
        ) : null}
      </div>
    </PageContainer>
  );
}

/** The held plan stated once — §29's line at the top of the chooser. */
function heldLine(plan: AccountPlanView, held: AccountPlanChoice | null): string {
  const planId = held?.planId ?? plan.planVersionRef;
  const state = plan.billing.state;
  const renews = formatDate(plan.billing.renewsAt);
  const trialEnds = formatDate(plan.billing.trialEndsAt);

  // **Built per state rather than concatenated from parts**, because the parts
  // produced "You are on free — Free week, free." and, on a plain free account,
  // "You are on free — Free, free." Three uses of one word in seven words, and
  // a reader could not tell whether they held a free plan, were inside a free
  // trial, or both — on the screen where they decide whether to pay for
  // something they may already have this week. Found by a browser walk; the
  // e2e asserted `toContainText("free")`, which every one of those satisfies.
  const paidFor =
    held === null || held.priceMinor === null || held.priceMinor === 0
      ? null
      : formatPrice(held.priceMinor, held.currency);

  let sentence: string;
  if (state === "trial") {
    // The one state with no subscription period, so `renewsAt` is null and the
    // trial's own expiry is the only date there is.
    sentence =
      trialEnds === null
        ? `You are on your free week, which includes everything in plus. Your plan is ${planId}.`
        : `You are on your free week until ${trialEnds}, which includes everything in plus. After that your plan is ${planId} unless you choose another.`;
  } else if (state === "none") {
    sentence = `You are on ${planId}, at no charge.`;
  } else if (state === "cancelling") {
    sentence = `You are on ${planId}${paidFor === null ? "" : ` at ${paidFor} a month`}, ending ${renews ?? "at the end of this period"}.`;
  } else if (state === "past-due") {
    sentence = `You are on ${planId}${paidFor === null ? "" : ` at ${paidFor} a month`}, and your last payment did not go through.`;
  } else if (state === "lapsed") {
    sentence = `Your ${planId} subscription has lapsed.`;
  } else {
    sentence = `You are on ${planId}${paidFor === null ? "" : ` at ${paidFor} a month`}${renews === null ? "" : `, renewing ${renews}`}.`;
  }

  // **Prorated to the day, said before anyone picks anything** — but only where
  // there is something to prorate. Telling a free account its change is
  // prorated is describing a refund of nothing.
  const prorates = state === "active" || state === "cancelling" || state === "past-due";
  return prorates ? `${sentence} A change now is prorated to the day.` : sentence;
}

function Chooser({
  plan,
  onChoose,
  canBuy,
}: {
  plan: AccountPlanView;
  onChoose: (planId: string) => void;
  canBuy: boolean;
}) {
  const held = plan.catalogue.find((choice) => choice.held) ?? null;
  const heldPlanId = held?.planId ?? plan.planVersionRef.split("@")[0];
  // **Is the account drawing on something the catalogue does not show?** The
  // resolved set is what it can do; the held plan's own list is what this page
  // prints. When they differ, a grant is in play and the page has to say so.
  const grantInPlay = plan.entitlements.some(
    (entitlement) => !(held?.entitlements ?? []).includes(entitlement),
  );
  return (
    <div className="flex flex-col gap-5">
      {/* **Three cards in display order, each with four bullets enumerating
          what it grants — never "everything in Plus"** (§29, and M20's most
          load-bearing rule met by a pricing page, which is where it dies
          quietly). The held card is the only emphasised one. */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3" data-testid="plan-cards">
        {plan.catalogue.map((choice) => (
          <div
            key={choice.planId}
            data-testid={`plan-card-${choice.planId}`}
            className={
              choice.held
                ? "flex flex-col gap-2 rounded-lg border border-border-strong bg-moss p-4"
                : "flex flex-col gap-2 rounded-lg border border-hairline p-4"
            }
          >
            <div className="flex items-center justify-between gap-2">
              <Heading level={3}>{choice.planId}</Heading>
              {choice.held ? <Badge variant="success">What you hold</Badge> : null}
            </div>
            <Text as="span" className="text-lg font-semibold text-ink">
              {choice.priceMinor === null
                ? "—"
                : choice.priceMinor === 0
                  ? "Free"
                  : `${formatPrice(choice.priceMinor, choice.currency)} / month`}
            </Text>
            <Text variant="secondary" className="text-xs">
              {whoItIsFor(choice)}
            </Text>
            <ul className="flex flex-col gap-1">
              {planBullets(choice).map((bullet) => (
                <li key={bullet} className="text-xs text-slate">
                  {bullet}
                </li>
              ))}
            </ul>
            <Button
              variant={choice.held ? "secondary" : "primary"}
              size="sm"
              className="mt-auto"
              disabled={choice.held || !canBuy}
              onClick={() => onChoose(choice.planId)}
              data-testid={`plan-choose-${choice.planId}`}
            >
              {choice.held ? "What you hold" : `Choose ${choice.planId}`}
            </Button>
          </div>
        ))}
      </div>

      <PlanComparison catalogue={plan.catalogue} />

      {/* **The plans as PUBLISHED, which is not the same as what you can do
          today** — and on this route the difference is the whole reason
          somebody is reading it. A brand-new account holds `free` and carries
          a `plus` trial: the account sheet says *Questions 0 / 50*, and the
          `free` card here says *No assistant*. Both are true and a person has
          no way to tell that from the screen, which is precisely the defect a
          browser walk found on the account sheet during M20 and the reason
          that sheet already carries a sentence like this one.
          Shown only while something is granted, so it is never a disclaimer
          about nothing. */}
      {/* **"Your free week" only when there IS one** (CodeRabbit, PR #177).
          `grantInPlay` is true for ANY source the catalogue does not show —
          founder, referral, admin, trial — and the copy named the trial for
          all of them. On this deployment that is the common case rather than
          the rare one: every account predating M20's migration carries a
          permanent founder grant, so the page told a founder their free week
          was doing it, and the one place a reader could check said otherwise.
          The neutral wording is true of every source including the trial; the
          trial keeps its own sentence because naming it is friendlier where it
          is accurate. */}
      {grantInPlay ? (
        <Text variant="secondary" className="text-xs" data-testid="plans-grant-note">
          {plan.billing.state === "trial"
            ? `These are the plans as published. Your free week grants you more than the ${heldPlanId} plan lists above — what you can actually do right now is in Account settings, under Plan.`
            : `These are the plans as published. Your account has been granted more than the ${heldPlanId} plan lists above — what you can actually do right now is in Account settings, under Plan.`}
        </Text>
      ) : null}
    </div>
  );
}

function Confirm({
  plan,
  preview,
  error,
  conflict,
  busy,
  onBack,
  onConfirm,
}: {
  plan: AccountPlanView;
  preview: PlanChangePreview | null;
  error: string | null;
  conflict: boolean;
  busy: boolean;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const held = plan.catalogue.find((choice) => choice.held) ?? null;
  return (
    <div className="flex flex-col gap-4" data-testid="plans-confirm">
      {conflict ? (
        <Banner variant="warning" data-testid="plans-version-conflict">
          The plans changed while you were reading this, so the numbers below have been
          recalculated. Nothing has been charged.
        </Banner>
      ) : null}
      {error !== null ? <Banner variant="warning">{error}</Banner> : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* **What changes, in the product's own terms and with the real
            names** — §29's *"Mei, Priya, Sam and Kenji go back to editing
            Japan — no re-invites"*. This build says it without the names: the
            account sheet knows what an account holds and not who is on its
            trips, and inventing a list here would mean this screen reaching
            into Access & Membership for a sentence. Named as a gap rather than
            faked. */}
        <div className="flex flex-col gap-2 rounded-lg border border-hairline p-4">
          <Heading level={2}>What changes</Heading>
          {preview === null ? (
            <Text variant="secondary" className="text-sm">
              Working out what this costs…
            </Text>
          ) : preview.kind === "cancel" ? (
            <Text className="text-sm" data-testid="confirm-what-changes">
              {cancelSentence(preview, held)}
            </Text>
          ) : (
            <Text className="text-sm" data-testid="confirm-what-changes">
              {gainSentence(preview, plan)}
            </Text>
          )}
        </div>

        {/* **The order card. Every figure is Stripe's** (§29). */}
        <div className="flex flex-col gap-2 rounded-lg border border-hairline p-4" data-testid="confirm-order">
          <Heading level={2}>Order</Heading>
          {preview === null ? (
            <Text variant="secondary" className="text-sm">
              Loading…
            </Text>
          ) : preview.kind === "cancel" ? (
            <Text variant="secondary" className="text-sm">
              Nothing is charged, and nothing is refunded. You keep what you have until the date
              above.
            </Text>
          ) : (
            <>
              <ul className="flex flex-col gap-1">
                {preview.lines.map((line, index) => (
                  <li
                    key={`${line.description}-${index}`}
                    className="flex justify-between gap-3 text-sm text-ink"
                  >
                    <span>{line.description}</span>
                    <span>{formatPrice(line.minor, preview.currency)}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-1 flex justify-between gap-3 border-t border-hairline pt-2 text-sm font-semibold text-ink">
                <span>Due today</span>
                <span data-testid="confirm-due-today">
                  {formatPrice(preview.dueTodayMinor, preview.currency)}
                </span>
              </div>
              <Text variant="secondary" className="text-xs">
                {renewalSentence(preview)}
              </Text>
              {preview.cardOnFile !== null ? (
                <Text variant="secondary" className="text-xs">
                  Paying with {preview.cardOnFile}.
                </Text>
              ) : null}
            </>
          )}

          <div className="mt-2 flex gap-2">
            <Button variant="ghost" size="sm" onClick={onBack} disabled={busy}>
              Back
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={onConfirm}
              disabled={preview === null || busy}
              data-testid="confirm-pay"
            >
              {confirmLabel(preview, busy)}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The primary button's label.
 *
 * §29's is `Pay $11.47 with Stripe` — the amount in the button, because the
 * amount is what is being agreed to and a button reading "Confirm" makes the
 * reader look back up to check what they are confirming.
 */
function confirmLabel(preview: PlanChangePreview | null, busy: boolean): string {
  if (busy) return "Working…";
  if (preview === null) return "Confirm";
  if (preview.kind === "cancel") return "Move to free";
  return `Pay ${formatPrice(preview.dueTodayMinor, preview.currency)} with Stripe`;
}

function renewalSentence(preview: PlanChangePreview): string {
  const when = formatDate(preview.effectiveAt);
  return when === null
    ? `Then ${preview.planId}, billed monthly, until you change it.`
    : `Then ${preview.planId}, billed monthly from ${when}, until you change it.`;
}

/** The losses, on the date they happen — never "you will lose access". */
function cancelSentence(preview: PlanChangePreview, held: AccountPlanChoice | null): string {
  const when = formatDate(preview.effectiveAt);
  const date = when === null ? "When the period you have paid for ends" : `On ${when}`;
  const collaborators = (held?.entitlements ?? []).includes("trip.collaborators")
    ? " and everyone else on your trips goes back to reading"
    : "";
  return `${date}: the assistant stops${collaborators}. Until then nothing changes, and choosing a paid plan again before that date undoes this entirely.`;
}

function gainSentence(preview: PlanChangePreview, plan: AccountPlanView): string {
  const target = plan.catalogue.find((choice) => choice.planId === preview.planId);
  const bullets = target === undefined ? [] : planBullets(target);
  return `${preview.planId} gives you ${bullets.join("; ").toLowerCase()}. It takes effect as soon as the payment clears — nothing to sign out of.`;
}

/**
 * **Return-from-Stripe-before-webhook** — the state §29 says has no design yet
 * and needs one, *"a pending state, not this one, and not a spinner that
 * lies"*.
 *
 * So it says what is actually happening rather than implying it is nearly done,
 * and when it has waited longer than it expected to it says that too, with the
 * one thing that is true: the payment is safe and the account will catch up.
 */
function Pending({ slow }: { slow: boolean }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-hairline p-4" data-testid="plans-pending">
      <Heading level={2}>Checking with Stripe</Heading>
      {/* **This screen does not know whether anything was paid, and it no
          longer says it does.** It said *"Your payment has gone through"* — on
          the presence of a query parameter, so a typed URL produced a claim of
          payment, and on a deployment that cannot take payments at all it
          appeared four inches under a banner saying so. Found by a browser
          walk of the preview; the e2e passed throughout, because it asserted
          that this panel was VISIBLE and never read a word of it.
          What is true is the sequence: Stripe tells us, and that is what moves
          a plan. So that is what it says. */}
      <Text className="text-sm">
        If you have just paid, Stripe tells us separately from sending you back here — and that
        message is what actually changes your plan. This page is waiting for it, usually a few
        seconds.
      </Text>
      {slow ? (
        <Banner variant="info" data-testid="plans-pending-slow">
          Nothing has arrived yet. If you completed a payment it is safe and your plan will change
          on its own, with no action from you. If you did not, nothing has been charged and nothing
          will change.
        </Banner>
      ) : null}
      {/* **A way out.** The pending panel replaces the chooser and the table,
          so without this the route is a page titled Plans, showing no plans,
          with nothing to click — reachable from a bookmark, a back button, or
          a webhook that never lands. */}
      <div className="flex flex-wrap gap-3">
        <Link href="/plans" className="text-sm text-brand underline" data-testid="plans-pending-back">
          Back to plans
        </Link>
        <Link href="/" className="text-sm text-brand underline">
          Back to your trips
        </Link>
      </div>
    </div>
  );
}
