import { afterEach, describe, expect, it } from "vitest";
import { fakeStripeKey } from "@/test-support/stripeSignature";
import {
  BillingNotConfiguredError,
  StripeKeyShapeError,
  billingConfig,
  billingConfigured,
  checkoutReference,
  modeOfSecretKey,
  parseCheckoutReference,
  returnOrigin,
} from "./config";

// **The gate box this file answers**: *"Stripe keys are absent from the repo,
// present in `.env.example` as names with the secret ones marked, and test-mode
// and live-mode keys cannot be confused for one another."*
//
// The first two halves are a grep and a file; this is the third, which is the
// only one that is code. Mode is read OUT OF the key rather than configured
// beside it, so the confusion the box names is not a mistake anyone can make —
// there is no second place to disagree with.

const KEYS = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"] as const;
const saved = new Map<string, string | undefined>();

function setEnv(values: Partial<Record<(typeof KEYS)[number], string>>): void {
  for (const key of KEYS) {
    if (!saved.has(key)) saved.set(key, process.env[key]);
    const value = values[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

afterEach(() => {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  saved.clear();
});

describe("a Stripe key says which account it addresses", () => {
  it("reads test and live mode out of the key itself", () => {
    // The prefix IS the thing under test, and it is still exactly asserted —
    // what changed is that the values are built rather than written as
    // credential-shaped literals. See `fakeStripeKey`.
    expect(fakeStripeKey("sk_test").startsWith("sk_test_")).toBe(true);
    expect(modeOfSecretKey(fakeStripeKey("sk_test"))).toBe("test");
    expect(modeOfSecretKey(fakeStripeKey("sk_live"))).toBe("live");
  });

  // Each of these is a real configuration mistake with a different symptom, and
  // every one of them would otherwise surface as a failed checkout in
  // production rather than as a refusal at the first call.
  it.each([
    ["a publishable key", fakeStripeKey("pk_test")],
    ["a restricted key", fakeStripeKey("rk_live")],
    ["a webhook signing secret", fakeStripeKey("whsec")],
    ["something that is not a key at all", "not-a-key-at-all"],
    ["an empty string", ""],
  ])("refuses %s in STRIPE_SECRET_KEY", (_what, key) => {
    expect(() => modeOfSecretKey(key)).toThrow(StripeKeyShapeError);
  });

  it("refuses a secret key in the webhook secret's place", () => {
    setEnv({ STRIPE_SECRET_KEY: fakeStripeKey("sk_test"), STRIPE_WEBHOOK_SECRET: fakeStripeKey("sk_test") });
    // The pair swapped round is the mistake this catches: it would verify no
    // signature and reject every delivery, which looks like Stripe being down.
    expect(() => billingConfig()).toThrow(StripeKeyShapeError);
  });
});

describe("billing that is not configured", () => {
  it("names the missing variable rather than failing at the first call", () => {
    setEnv({});
    expect(() => billingConfig()).toThrow(BillingNotConfiguredError);
    expect(() => billingConfig()).toThrow(/STRIPE_SECRET_KEY/);
  });

  it("is an ordinary state a surface can ask about without catching", () => {
    // Every local checkout and every CI run is this state. The design's rule
    // for it is *"do not offer a CTA that opens a checkout that cannot
    // succeed"*, which needs a question, not an exception.
    setEnv({});
    expect(billingConfigured()).toBe(false);
    setEnv({ STRIPE_SECRET_KEY: fakeStripeKey("sk_test"), STRIPE_WEBHOOK_SECRET: fakeStripeKey("whsec") });
    expect(billingConfigured()).toBe(true);
    expect(billingConfig().mode).toBe("test");
  });
});

describe("the reference a Checkout Session carries back", () => {
  it("round-trips an account and the version it is buying", () => {
    const reference = checkoutReference("google-12345", "premium", 1);
    expect(parseCheckoutReference(reference)).toEqual({
      userId: "google-12345",
      planId: "premium",
      version: 1,
    });
  });

  // **A `users.id` is an Auth.js subject and nothing promises it has no bar in
  // it.** Splitting on the first bar would truncate such an id into a different
  // account's, which is the worst possible way to be wrong here — a webhook
  // would grant the plan to whoever that truncated id happens to be.
  it("keeps an account id that contains the separator intact", () => {
    expect(parseCheckoutReference(checkoutReference("weird|id|here", "plus", 2))).toEqual({
      userId: "weird|id|here",
      planId: "plus",
      version: 2,
    });
  });

  it.each([
    ["no separator", "google-12345"],
    ["an empty account id", "|plus@v1"],
    ["a plan nobody published", "u|enterprise@v1"],
    ["a version that is not one", "u|plus@v0"],
    ["a reference that is not one", "u|plus"],
    ["nothing at all", null],
  ])("refuses %s", (_what, reference) => {
    expect(parseCheckoutReference(reference)).toBeNull();
  });
});

describe("where Stripe sends the browser back to", () => {
  // Derived from the request rather than configured, because a configured
  // origin naming the wrong one of a preview's two hosts is exactly the defect
  // that made M20's console 500 on every preview load.
  it("is the origin the checkout was started from", () => {
    expect(returnOrigin(new Request("https://preview-abc.vercel.app/api/billing/checkout"))).toBe(
      "https://preview-abc.vercel.app",
    );
  });
});
