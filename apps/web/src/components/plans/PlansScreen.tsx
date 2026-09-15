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
import { PLAN_STATE_LABEL, formatDate, formatPrice } from "@/lib/planCopy";
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
  | { name: "pending" }
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

export function PlansScreen() {
  const params = useSearchParams();
  const checkout = params.get("checkout");
  const [plan, setPlan] = useState<AccountPlanView | null>(null);
  const [failed, setFailed] = useState(false);
  const [step, setStep] = useState<Step>(
    // **Returning from Stripe lands on pending, not on success.** The query
    // parameter proves a browser followed a URL and nothing else.
    checkout !== null && checkout !== "cancelled" ? { name: "pending" } : { name: "chooser" },
  );
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
    });
  }, [load]);

  // **The pending state's only job: ask whether the webhook has landed yet.**
  useEffect(() => {
    if (step.name !== "pending") return;
    let attempts = 0;
    let live = true;
    const before = plan?.planVersionRef ?? null;
    const timer = setInterval(() => {
      if (!live) return;
      attempts += 1;
      void load().then((loaded) => {
        if (!live || loaded === null) return;
        // The webhook has written when the held plan moves, or when a
        // subscription appears where there was none.
        const moved = before !== null && loaded.planVersionRef !== before;
        if (moved || loaded.billing.state === "active" || loaded.billing.state === "cancelling") {
          clearInterval(timer);
          setStep({ name: "result", message: "Your plan is active. Everything is live — no need to sign out." });
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
  }, [step.name, load, plan?.planVersionRef]);

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
      setStep({ name: "pending" });
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
  const state = PLAN_STATE_LABEL[plan.billing.state];
  const price =
    held === null || held.priceMinor === null
      ? null
      : held.priceMinor === 0
        ? "free"
        : `${formatPrice(held.priceMinor, held.currency)} a month`;
  const renews = formatDate(plan.billing.renewsAt);
  const parts = [`You are on ${held?.planId ?? plan.planVersionRef} — ${state}`];
  if (price !== null) parts.push(price);
  if (renews !== null) {
    parts.push(plan.billing.state === "cancelling" ? `ending ${renews}` : `renewing ${renews}`);
  }
  // **Prorated to the day, said before anyone picks anything.** The confirm
  // step's order card is where the number appears; this is the promise it keeps.
  return `${parts.join(", ")}. A change now is prorated to the day.`;
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
    <div className="flex flex-col gap-2 rounded-lg border border-hairline p-4" data-testid="plans-pending">
      <Heading level={2}>Waiting for Stripe to confirm</Heading>
      <Text className="text-sm">
        Your payment has gone through. We are waiting for Stripe to tell us about it, which is what
        actually changes your plan — usually a few seconds.
      </Text>
      {slow ? (
        <Banner variant="info" data-testid="plans-pending-slow">
          This is taking longer than usual. Your payment is safe and your plan will change on its
          own; you can close this page.
        </Banner>
      ) : null}
    </div>
  );
}
