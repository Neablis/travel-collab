// **The Billing module's configuration, and the one thing it refuses to do**
// (M21's gate box: *"test-mode and live-mode keys cannot be confused for one
// another"*).
//
// Two pairs of names (ADR-076 §5), none of their values in this repo.
// `.env.example` carries the names with the secret ones marked, and the values
// live in Vercel's environment scopes — the same arrangement
// `LOCATIONIQ_API_KEY` and `AI_GATEWAY_API_KEY` have.
//
// **Read lazily, never at module load.** `serverConfig` is a module-level
// object literal, which is why two `modelSelection` tests had to reach into
// module registry internals to change a value (`KI-2026-09-11-c`). A function
// costs one call and makes this module importable by a test that has set no
// environment at all — which the signature and price tests both do.
import * as Sentry from "@sentry/nextjs";
import { PlanId } from "@tc/contracts";

/**
 * Which Stripe account these keys address.
 *
 * Stripe encodes the mode in the key itself — `sk_test_` / `sk_live_`,
 * `whsec_` being the same in both — so this is read from the key rather than
 * configured beside it. A separate `STRIPE_MODE` variable would be a second
 * source of truth for a fact the first one already carries, and the failure it
 * enables is the exact one the gate box names: a deployment pointed at live
 * Stripe while something believes it is in test.
 */
export type StripeMode = "test" | "live";

/** One Stripe account's credentials: the key that calls it, the secret it signs with. */
export interface StripeKeyPair {
  secretKey: string;
  webhookSecret: string;
}

/**
 * The key pairs this deployment holds, by the mode each addresses (ADR-076 §5).
 *
 * At most one per mode. `primary` is the mode of the pair in `STRIPE_SECRET_KEY`,
 * which every deployment that sells anything has; the `STRIPE_TEST_*` pair beside
 * it is optional and is how production takes a test card.
 */
export interface BillingConfig {
  primary: StripeMode;
  live?: StripeKeyPair;
  test?: StripeKeyPair;
  /** Why a set `STRIPE_TEST_*` pair was not taken; test-mode calls throw it. */
  testPairProblem?: Error;
}

/** Thrown when billing is asked to act and has not been configured to. */
export class BillingNotConfiguredError extends Error {
  constructor(what: string) {
    super(
      `${what} is not set. Billing needs STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET, and ` +
        `test mode beside live needs STRIPE_TEST_SECRET_KEY and STRIPE_TEST_WEBHOOK_SECRET; ` +
        `see .env.example. Vercel injects environment variables at build time, so setting ` +
        `one in the dashboard needs a redeploy before it reaches a deployment.`,
    );
    this.name = "BillingNotConfiguredError";
  }
}

/** Thrown when a key is present and is not a key of the shape it claims. */
export class StripeKeyShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StripeKeyShapeError";
  }
}

/**
 * The mode a secret key addresses, refusing anything that is not one.
 *
 * **A restricted key (`rk_`) is refused too**, and deliberately, even though
 * Stripe would accept many of our calls with one: a restricted key fails at the
 * first call whose permission was not granted, which for this module means a
 * checkout that works and a Price lookup that does not, discovered in
 * production. One key shape, one failure mode.
 */
export function modeOfSecretKey(key: string): StripeMode {
  if (key.startsWith("sk_test_")) return "test";
  if (key.startsWith("sk_live_")) return "live";
  throw new StripeKeyShapeError(
    `STRIPE_SECRET_KEY is not a Stripe secret key. Expected it to begin "sk_test_" or ` +
      `"sk_live_"; a publishable key ("pk_"), a restricted key ("rk_") or a webhook signing ` +
      `secret ("whsec_") in this variable is a configuration mistake that would otherwise ` +
      `surface as a failed checkout.`,
  );
}

/** A pair from two variables, or a throw naming whichever is missing or misshapen. */
function keyPairFrom(keyVariable: string, secretVariable: string): StripeKeyPair {
  const secretKey = process.env[keyVariable] ?? "";
  const webhookSecret = process.env[secretVariable] ?? "";
  if (secretKey === "") throw new BillingNotConfiguredError(keyVariable);
  if (webhookSecret === "") throw new BillingNotConfiguredError(secretVariable);
  if (!webhookSecret.startsWith("whsec_")) {
    throw new StripeKeyShapeError(
      `${secretVariable} is not a webhook signing secret. Expected it to begin "whsec_". ` +
        `The secret key in this variable would verify no signature and reject every delivery.`,
    );
  }
  return { secretKey, webhookSecret };
}

/**
 * The billing configuration, or a throw naming what is missing from the
 * primary pair.
 *
 * Callers that must work without billing configured — the account sheet, which
 * renders a plan whether or not anyone can buy one — use `billingConfigured()`
 * below instead of catching this.
 *
 * **The test pair is refused whole rather than half-used, and refused alone.**
 * Half a pair can either call Stripe or verify its deliveries but not both, and
 * a live key in it is the confusion M21's gate box names, arriving by a new
 * door. But it is optional and live billing never reads it, so a broken one
 * reads as absent, with the reason kept for `stripeKeyPair("test")` to throw:
 * throwing here took live checkout and every live delivery down with it (PR 476
 * review, finding 1).
 */
export function billingConfig(): BillingConfig {
  const primaryPair = keyPairFrom("STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET");
  const primary = modeOfSecretKey(primaryPair.secretKey);
  const config: BillingConfig = { primary, [primary]: primaryPair };

  const testKey = process.env.STRIPE_TEST_SECRET_KEY ?? "";
  const testSecret = process.env.STRIPE_TEST_WEBHOOK_SECRET ?? "";
  if (testKey === "" && testSecret === "") return config;
  try {
    return { ...config, test: testPairBeside(primary, primaryPair) };
  } catch (error) {
    const problem = error instanceof Error ? error : new Error(String(error));
    reportTestPairOnce(problem);
    return { ...config, testPairProblem: problem };
  }
}

/** The `STRIPE_TEST_*` pair, or a throw saying why it cannot sit beside the primary one. */
function testPairBeside(primary: StripeMode, primaryPair: StripeKeyPair): StripeKeyPair {
  const testPair = keyPairFrom("STRIPE_TEST_SECRET_KEY", "STRIPE_TEST_WEBHOOK_SECRET");
  if (!testPair.secretKey.startsWith("sk_test_")) {
    throw new StripeKeyShapeError(
      `STRIPE_TEST_SECRET_KEY must be a test-mode secret key, beginning "sk_test_". A live ` +
        `key here would take real money through the path an admin opens for test cards.`,
    );
  }
  if (primary === "test") {
    throw new StripeKeyShapeError(
      `STRIPE_SECRET_KEY is already a test key, so STRIPE_TEST_SECRET_KEY would make two ` +
        `test-mode pairs. A deployment holds at most one pair per mode: unset the STRIPE_TEST_* ` +
        `pair here, or put the live pair in STRIPE_SECRET_KEY.`,
    );
  }
  // The live secret is tried first, so every test delivery would verify as
  // live and be refused `mode-mismatch`, on every one of Stripe's retries.
  if (testPair.webhookSecret === primaryPair.webhookSecret) {
    throw new StripeKeyShapeError(
      `STRIPE_TEST_WEBHOOK_SECRET is the same signing secret as STRIPE_WEBHOOK_SECRET. Each ` +
        `Stripe endpoint has its own; take the test-mode endpoint's.`,
    );
  }
  return testPair;
}

// `billingConfig()` is read on every call that touches Stripe, so the warning
// is once per message per process rather than once per request.
const reportedTestPairProblems = new Set<string>();

function reportTestPairOnce(problem: Error): void {
  if (reportedTestPairProblems.has(problem.message)) return;
  reportedTestPairProblems.add(problem.message);
  console.warn(`Stripe test mode is off on this deployment: ${problem.message}`);
  Sentry.captureMessage(`Stripe test mode is off: ${problem.message}`, "warning");
}

/** The mode a row's `livemode` column names. */
export function modeOfLivemode(livemode: boolean): StripeMode {
  return livemode ? "live" : "test";
}

/** The pair for one mode, or a throw naming the variables that would supply it. */
export function stripeKeyPair(mode: StripeMode): StripeKeyPair {
  const config = billingConfig();
  const pair = config[mode];
  if (pair === undefined) {
    if (mode === "test" && config.testPairProblem !== undefined) throw config.testPairProblem;
    throw new BillingNotConfiguredError(
      mode === "test" ? "STRIPE_TEST_SECRET_KEY" : "A live STRIPE_SECRET_KEY",
    );
  }
  return pair;
}

/**
 * Whether a checkout could be started at all, without throwing.
 *
 * **Every surface that offers to sell something asks this first**, because the
 * design's own rule for the unreachable case is *"do not offer a CTA that opens
 * a checkout that cannot succeed"* (SPEC §29). A deployment with no Stripe keys
 * is a legitimate state — every local checkout and every CI run is one — and it
 * must read as "not for sale here", never as an error page.
 */
export function billingConfigured(): boolean {
  try {
    billingConfig();
    return true;
  } catch {
    return false;
  }
}

/**
 * Where Stripe sends the browser back to.
 *
 * Taken from the request the checkout was started by, not from configuration.
 * The one thing configuration could add here is a way to be wrong: preview
 * deployments have per-deployment hosts and a branch alias, and a configured
 * origin naming the wrong one of those is precisely the defect that made
 * M20's console 500 on every preview load.
 *
 * **Nothing credential-bearing travels to this origin.** It is where the
 * person's own browser is returning, and the return proves nothing on its own
 * (M21 link 4) — which is what makes deriving it from the request safe here
 * and unsafe in the case that produced that defect.
 */
export function returnOrigin(request: Request): string {
  return new URL(request.url).origin;
}

/**
 * The metadata key naming the deployment a checkout began on, its
 * `deploymentOrigin()`, written on the session, the subscription and the
 * customer. A test-mode event applies only on the deployment it names
 * (`webhook.ts`, `writeFrom`).
 */
export const ORIGIN_METADATA_KEY = "deploymentOrigin";

/**
 * The `client_reference_id` a Checkout Session carries, and the plan it names.
 *
 * Stripe hands this back verbatim on `checkout.session.completed`, and it is
 * how the webhook knows which account and which plan version a session was
 * for **without trusting anything the browser sent**. Metadata would do the
 * same job; this field exists for exactly this and is echoed on more event
 * types.
 */
export function checkoutReference(userId: string, planId: PlanId, version: number): string {
  return `${userId}|${planId}@v${version}`;
}

/** The pair a `client_reference_id` was built from, or `null` if it is not one. */
export function parseCheckoutReference(
  reference: string | null | undefined,
): { userId: string; planId: PlanId; version: number } | null {
  if (typeof reference !== "string") return null;
  // **Split once, from the right of the first bar.** A `users.id` is an
  // Auth.js subject and this code has no promise that it contains no bar, so
  // splitting on every bar and taking [0] would truncate an id rather than
  // fail on it. The plan reference is the tail and is the part with a known
  // shape, so it is the part that is matched.
  const bar = reference.lastIndexOf("|");
  if (bar <= 0) return null;
  const userId = reference.slice(0, bar);
  const match = /^([a-z]+)@v([1-9][0-9]*)$/.exec(reference.slice(bar + 1));
  if (match === null) return null;
  const planId = PlanId.safeParse(match[1]);
  if (!planId.success) return null;
  return { userId, planId: planId.data, version: Number(match[2]) };
}
