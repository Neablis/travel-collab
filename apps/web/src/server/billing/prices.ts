// **Where the plan file and Stripe are made to agree** (M21 link 2).
//
// The division of authority, stated once in the milestone and worth repeating
// at the seam that implements it: **the plan version is the source of truth for
// what is granted; Stripe is the source of truth for what is charged.** They
// must agree, and this module is the only thing that checks.
//
// The failure it exists to catch is the worst class of billing bug because
// nothing errors: a version whose Stripe Price says a different number, so the
// pricing page and the card statement disagree and every party involved is
// reading a system that looks consistent.
//
// **Resolution is idempotent and runs at the moment of use.** M21 link 2:
// *"whatever creates or links the Price must be idempotent and must run
// somewhere a deploy reaches — a committed `stripe_price_id` that names a Price
// nobody created is a checkout that fails at the till."* Find by the derived
// lookup key, verify amount and currency, create only if absent. The first
// checkout of a newly published price creates its Price; every one after finds
// it.
import {
  PLAN_VERSIONS,
  isPurchasable,
  planVersionRefOf,
  priceLookupKey,
  type PlanVersion,
} from "@/server/entitlements/planVersions";
import {
  createPrice,
  findPriceByLookupKey,
  StripeApiError,
  type StripePrice,
} from "./stripeApi";
import { billingConfigured } from "./config";

/**
 * The plan file and Stripe disagree about what something costs.
 *
 * **Never recovered from, and never by creating a second Price.** Stripe Prices
 * are immutable, so a Price under our lookup key with the wrong amount means
 * either the key was reused by hand or the committed price was changed without
 * a new version — and both of those are a person's mistake to look at, not a
 * condition to route around. Silently creating another Price is how an account
 * gets charged one number while the page shows another.
 */
export class PriceMismatchError extends Error {
  readonly ref: string;
  readonly expected: { minor: number; currency: string };
  readonly found: { minor: number | null; currency: string; interval?: string };

  constructor(
    ref: string,
    expected: { minor: number; currency: string },
    found: { minor: number | null; currency: string; interval?: string },
  ) {
    super(
      `Stripe Price for ${ref} charges ${found.minor ?? "nothing"} ${found.currency}` +
        `${found.interval === undefined ? "" : ` every ${found.interval}`} and the committed ` +
        `plan version says ${expected.minor} ${expected.currency} every month. Published prices ` +
        `are never edited (M21 link 2) — publish a NEW version instead of reusing this one, ` +
        `which changes the lookup key and therefore the Price.`,
    );
    this.name = "PriceMismatchError";
    this.ref = ref;
    this.expected = expected;
    this.found = found;
  }
}

/** A version that cannot be sold was asked to be. */
export class UnpurchasableVersionError extends Error {
  readonly ref: string;

  constructor(ref: string, reason: string) {
    super(`${ref} cannot be bought: ${reason}`);
    this.ref = ref;
    this.name = "UnpurchasableVersionError";
  }
}

/** What a Stripe Price says, narrowed to the two facts that must match. */
function statedBy(price: StripePrice): { minor: number | null; currency: string } {
  return { minor: price.unit_amount, currency: price.currency };
}

/**
 * Check one Stripe Price against the version it is meant to be selling.
 *
 * Amount and currency, which is exactly what the gate box asks for. Not the
 * interval — a monthly Price under a key we derived can only have been created
 * by `createPrice` below, and widening the check to fields nothing else writes
 * buys nothing.
 */
export function assertPriceMatches(entry: PlanVersion, price: StripePrice): void {
  const expected = entry.price;
  if (expected === null) throw new UnpurchasableVersionError(planVersionRefOf(entry), "it has no price");
  if (price.unit_amount !== expected.minor || price.currency !== expected.currency) {
    throw new PriceMismatchError(planVersionRefOf(entry), expected, statedBy(price));
  }
  // **The interval is part of what was agreed, not a detail of it.** Amount and
  // currency are what the gate box names, and they are not sufficient: a YEARLY
  // Price of $9 USD passes both while the catalogue, the card and every screen
  // say "$9 / month". The buyer gets a twelfth of what they were shown, and
  // nothing errors — the exact shape of failure this module exists for.
  // CodeRabbit, PR #177.
  if (price.recurring?.interval !== "month") {
    throw new PriceMismatchError(
      planVersionRefOf(entry),
      expected,
      { ...statedBy(price), interval: price.recurring?.interval ?? "one-off" },
    );
  }
}

/**
 * The Stripe Price this plan version is sold as — found, checked, or created.
 *
 * The committed `stripePriceId` short-circuits nothing on purpose: when one is
 * present it is still checked against Stripe, because an id committed by hand
 * is exactly the thing that can name the wrong Price. What it saves is a list
 * call, not a verification.
 */
export async function stripePriceFor(entry: PlanVersion): Promise<string> {
  const ref = planVersionRefOf(entry);
  if (!isPurchasable(entry)) {
    throw new UnpurchasableVersionError(
      ref,
      entry.price === null
        ? "the version names no price"
        : entry.price.minor === 0
          ? "it costs nothing, and a free plan is reached by cancelling rather than by paying"
          : "the version is not enabled",
    );
  }
  const lookupKey = priceLookupKey(entry);
  // Unreachable while `isPurchasable` holds — both refuse the same two states —
  // and asserted rather than assumed, because the two could drift apart.
  if (lookupKey === null) throw new UnpurchasableVersionError(ref, "it has no lookup key");

  const existing = await findPriceByLookupKey(lookupKey);
  if (existing !== null) {
    assertPriceMatches(entry, existing);
    return existing.id;
  }

  const price = entry.price!;
  try {
    const created = await createPrice({
      lookupKey,
      currency: price.currency,
      unitAmount: price.minor,
      // The Stripe dashboard's own label. The version is in it because a
      // Product per version is what makes that dashboard's history readable —
      // see `createPrice`.
      productName: `Caesura ${entry.planId} (${ref})`,
    });
    assertPriceMatches(entry, created);
    return created.id;
  } catch (error) {
    // **Two callers racing the same first checkout.** Both find nothing, both
    // create; Stripe refuses the second because a lookup key is unique per
    // account. That is not an error to show anyone — the Price the other call
    // created is the right one, so look it up and use it.
    if (error instanceof StripeApiError && error.status === 400) {
      const raced = await findPriceByLookupKey(lookupKey);
      if (raced !== null) {
        assertPriceMatches(entry, raced);
        return raced.id;
      }
    }
    throw error;
  }
}

/** One line of the consistency report below. */
export interface PriceCheckRow {
  ref: string;
  /** What the committed plan file says, or `null` for an unpriced version. */
  committed: { minor: number; currency: string } | null;
  /** What Stripe says, or `null` when no Price carries this version's key. */
  stripe: { id: string; minor: number | null; currency: string } | null;
  /** `ok`, `missing` (nothing created yet), or `mismatch` (the real finding). */
  verdict: "ok" | "missing" | "mismatch" | "unpriced";
}

/**
 * The plan file's price narrowed to what a row reports. A spread would also
 * carry `stripePriceId` to the console under a type that does not declare it.
 */
function committedOf(price: { minor: number; currency: string }): { minor: number; currency: string } {
  return { minor: price.minor, currency: price.currency };
}

/**
 * **The gate box, as a function**: every published priced version's Stripe
 * Price resolves to one with the same amount and currency.
 *
 * Reports rather than throws, because the answer is a table an operator reads
 * and `missing` is an ordinary state — a price published in a deploy that
 * nobody has bought yet has no Stripe Price, and creating one as a side effect
 * of checking would make the check a write. `mismatch` is the row that matters
 * and the one a caller should refuse to ship past.
 */
export async function checkPriceConsistency(): Promise<PriceCheckRow[]> {
  const rows: PriceCheckRow[] = [];
  for (const entry of PLAN_VERSIONS) {
    const ref = planVersionRefOf(entry);
    const lookupKey = priceLookupKey(entry);
    if (entry.price === null || lookupKey === null) {
      rows.push({
        ref,
        committed: entry.price === null ? null : committedOf(entry.price),
        stripe: null,
        verdict: "unpriced",
      });
      continue;
    }
    const price = await findPriceByLookupKey(lookupKey);
    if (price === null) {
      rows.push({ ref, committed: committedOf(entry.price), stripe: null, verdict: "missing" });
      continue;
    }
    const matches =
      price.unit_amount === entry.price.minor &&
      price.currency === entry.price.currency &&
      price.recurring?.interval === "month";
    rows.push({
      ref,
      committed: committedOf(entry.price),
      stripe: { id: price.id, ...statedBy(price) },
      verdict: matches ? "ok" : "mismatch",
    });
  }
  return rows;
}

/**
 * What the operator console shows for the sweep above (KI-2026-09-16-c).
 *
 * `checked` carries the rows. The other two are why this is a union and not a
 * bare array: an EMPTY table would read as "nothing disagrees", which is the
 * one thing this cannot say when it never asked.
 */
export type PriceConsistencyReport =
  | { status: "checked"; rows: PriceCheckRow[] }
  /** No Stripe keys on this deployment — a supported state, and nothing to ask. */
  | { status: "unconfigured" }
  /** Stripe was asked and did not answer; `reason` is its error's message. */
  | { status: "unavailable"; reason: string };

/**
 * **`checkPriceConsistency` for a caller that must not fail: it never throws.**
 *
 * The console is where an operator reads this, so a Stripe outage must cost
 * that one panel rather than the whole page — and a deployment with no billing
 * (local, CI, every e2e run) is not asked at all, because its first
 * `stripeRequest` would throw `BillingNotConfiguredError`.
 */
export async function priceConsistencyReport(): Promise<PriceConsistencyReport> {
  if (!billingConfigured()) return { status: "unconfigured" };
  // **Bounded here, not by shortening `stripeRequest`'s own timeout**, which
  // checkout shares and which is right for a buyer waiting on one call. The
  // sweep makes its calls one version after another, so a stalled Stripe would
  // otherwise hold the whole console for that timeout per priced version.
  // Losing the race abandons the sweep's result, not its requests: those run
  // on to their own timeout, and they are GETs.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<PriceConsistencyReport>((resolve) => {
    timer = setTimeout(
      () => resolve({ status: "unavailable", reason: "timed out" }),
      PRICE_CHECK_DEADLINE_MS,
    );
  });
  const sweep = checkPriceConsistency().then(
    (rows): PriceConsistencyReport => ({ status: "checked", rows }),
    (error: unknown): PriceConsistencyReport => ({
      status: "unavailable",
      reason: error instanceof Error ? error.message : String(error),
    }),
  );
  try {
    return await Promise.race([sweep, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** How long the console waits for the price sweep before reporting it `unavailable`. */
export const PRICE_CHECK_DEADLINE_MS = 3_000;
