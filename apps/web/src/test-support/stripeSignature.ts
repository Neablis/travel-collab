import { createHmac } from "node:crypto";

// **Sign a body the way Stripe signs one** — for tests, and deliberately a
// SECOND implementation rather than a helper exported from
// `server/billing/signature.ts`.
//
// A test that signs with the same code it verifies with proves only that the
// code agrees with itself: a mistake in how the signed payload is composed —
// the separator, the encoding, the order of timestamp and body — would be
// symmetric and therefore invisible. The scheme is Stripe's and is written out
// here from its documentation, so the two have to agree for a reason.
//
// The one thing neither can prove is interop with Stripe itself. That needs a
// real delivery, and it is what the milestone's gate walk is for.
export function signStripePayload(rawBody: string, secret: string, at: Date): string {
  const timestamp = Math.floor(at.getTime() / 1000);
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("hex");
  return `t=${timestamp},v1=${signature}`;
}
