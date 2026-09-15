import * as Sentry from "@sentry/nextjs";
import { billingConfig } from "@/server/billing/config";
import { constructStripeEvent, WebhookSignatureError } from "@/server/billing/signature";
import { applyStripeEvent } from "@/server/billing/webhook";

// **The sole writer of subscription state** (M21 link 4).
//
// **Unauthenticated by necessity and signed by requirement.** Stripe has no
// session with us; the HMAC over the raw body is the entire boundary, and a
// request that forges one can grant itself any plan. Hence the ordering below,
// which is a gate box rather than a style: `request.text()` then verify then
// parse, with no other path from a body to an event anywhere in the app.
//
// **`runtime = "nodejs"`** because the verification is `node:crypto` and the
// body must be read as raw bytes. Edge would give neither.
export const runtime = "nodejs";
// Never prerendered, never cached: this is a write endpoint.
export const dynamic = "force-dynamic";

/**
 * **What answer means what to Stripe**, because it decides whether it retries:
 *
 *   * **200** — we have it. Applied, or deliberately not applied (a replay, a
 *     stale delivery, an event type we do not handle). All four are final
 *     answers, so all four are 200: a non-2xx on an event we simply do not
 *     handle would make Stripe retry it for three days.
 *   * **400** — the signature did not verify. No retry will fix a body we
 *     cannot attribute, and answering 500 would have Stripe retrying an
 *     attacker's request for us.
 *   * **500** — we failed. Stripe should retry, and the ordering tolerance and
 *     the idempotency claim are both built so that a retry after a partial
 *     failure converges rather than double-applies.
 */
export async function POST(request: Request) {
  let secret: string;
  try {
    secret = billingConfig().webhookSecret;
  } catch (error) {
    // No signing secret configured means every delivery is refused, which is
    // the safe direction and is not the same thing as working. 500 rather than
    // 400: it is our misconfiguration, the retry costs nothing, and a
    // deployment that grows its keys will then catch up on its backlog.
    Sentry.captureException(error);
    return Response.json({ error: "billing-not-configured" }, { status: 500 });
  }

  // **The raw body, exactly as Stripe sent it.** Not `request.json()` and not a
  // re-serialisation of one: the HMAC is over bytes, and a JSON round trip
  // reorders keys and drops whitespace, so verifying a re-serialised body fails
  // for well-formed payloads in a way that looks random.
  const rawBody = await request.text();

  let event;
  try {
    event = constructStripeEvent({
      rawBody,
      header: request.headers.get("stripe-signature"),
      secret,
    });
  } catch (error) {
    if (error instanceof WebhookSignatureError) {
      // **Not reported to Sentry.** A public endpoint collects unsigned
      // requests the way any public endpoint does, and paging on them would
      // turn background noise into an alert that gets muted — and then the real
      // one is muted too.
      return Response.json({ error: "bad-signature" }, { status: 400 });
    }
    throw error;
  }

  try {
    const outcome = await applyStripeEvent(event);
    return Response.json({ ok: true, ...outcome }, { status: 200 });
  } catch (error) {
    // **Reported, and then answered 500 so Stripe retries.** Losing an event
    // here is losing a payment's effect: an account that paid and was not
    // granted, or one that cancelled and was not lapsed.
    Sentry.captureException(error, { tags: { stripeEventType: event.type } });
    return Response.json({ error: "apply-failed" }, { status: 500 });
  }
}
