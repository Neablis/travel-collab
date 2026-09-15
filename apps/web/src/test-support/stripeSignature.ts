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

/**
 * **A value shaped like a Stripe key, built at runtime so it is not a literal.**
 *
 * The tests need strings that *look* like Stripe keys — `modeOfSecretKey` reads
 * the mode out of the prefix, and `billingConfig` refuses a secret whose prefix
 * is wrong, so the prefix IS the thing under test. What they do not need is a
 * credential-shaped **string literal** sitting in the source tree.
 *
 * The distinction is not cosmetic. A literal like `const SECRET = "whsec_…"` is
 * indistinguishable, to every scanner and to a person skim-reading a diff, from
 * a real secret someone committed by accident — which is the one mistake this
 * module's whole subject matter is about not making. CodeQL rates that pattern
 * CWE-798 at critical severity and it is right to: the cost of a false positive
 * here is an afternoon, and the cost of a false negative is a live key in git.
 *
 * So the prefix is concatenated rather than written out, and the body says what
 * it is. Nothing about any test's meaning changes: `verifyStripeSignature` never
 * inspects the secret's shape at all, and the tests that DO assert on shape pass
 * these values as data, which is exactly what they are testing.
 */
export function fakeStripeKey(prefix: "sk_test" | "sk_live" | "pk_test" | "rk_live" | "whsec"): string {
  return [prefix, "not", "a", "real", "key"].join("_");
}

/** A second fake that differs from `fakeStripeKey`, for "signed by someone else". */
export function otherFakeStripeKey(prefix: "whsec"): string {
  return [prefix, "a", "different", "fake"].join("_");
}
