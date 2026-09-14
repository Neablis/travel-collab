// **Stripe over its REST API, with no SDK** (ADR-047).
//
// Six calls, all of them form-encoded POSTs or plain GETs: create a customer,
// create a Checkout Session, create a Billing Portal session, retrieve a
// subscription, find a Price by lookup key, create a Price. That is the whole
// surface this product needs, and the reason it is this small is the reason
// the milestone exists in the shape it does — **the app never sees a card
// number** (M21 link 3). Everything to do with a card happens on Stripe's own
// pages, so none of the SDK's client-side machinery has anything to do here.
//
// **What an SDK would have bought and what it would have cost** is ADR-047's
// subject; the short version is that the thing worth having from it —
// `webhooks.constructEvent` — is thirty lines of `node:crypto` we can order
// ourselves, and the gate box asks for an ordering claim (*"rejected before
// its body is parsed"*) that is only provable if we control the order.
//
// **Idempotency keys on every write.** Stripe deduplicates a retried POST that
// carries one, for 24 hours. Without them a network timeout on
// `POST /v1/customers` — where the request succeeded and the response was
// lost — creates a second customer on the retry, which is how an account ends
// up with two invoice histories and the portal shows the wrong one.
import { billingConfig } from "./config";

const STRIPE_API = "https://api.stripe.com/v1";

// Pinned, because Stripe's response shapes change with it and this module
// reads specific fields. An unpinned client gets whatever version the account's
// dashboard is set to, which can be changed by a person who is not deploying
// this code.
const STRIPE_API_VERSION = "2025-08-27.basil";

/** Stripe answered, and what it said was an error. */
export class StripeApiError extends Error {
  constructor(
    readonly status: number,
    readonly stripeCode: string | null,
    message: string,
  ) {
    super(message);
    this.name = "StripeApiError";
  }
}

/**
 * Stripe's form encoding: nested objects and arrays become bracketed keys.
 *
 * `{ a: { b: 1 }, c: ["x"] }` is `a[b]=1&c[0]=x`. Stripe accepts nothing else
 * on a write, and getting this wrong is a 400 with a field name in it rather
 * than anything subtle — which is why it is worth the twenty lines and not
 * worth a dependency.
 *
 * `undefined` values are DROPPED and `null` is sent as an empty string, which
 * is how Stripe spells "unset this field". The two are different requests and
 * conflating them would silently clear fields a caller meant to leave alone.
 */
export function formEncode(payload: Record<string, unknown>, prefix = ""): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(payload)) {
    const name = prefix === "" ? key : `${prefix}[${key}]`;
    if (value === undefined) continue;
    if (value === null) {
      parts.push(`${encodeURIComponent(name)}=`);
    } else if (Array.isArray(value)) {
      value.forEach((item, index) => {
        const element = `${name}[${index}]`;
        if (item !== null && typeof item === "object") {
          parts.push(formEncode(item as Record<string, unknown>, element));
        } else {
          parts.push(`${encodeURIComponent(element)}=${encodeURIComponent(String(item))}`);
        }
      });
    } else if (typeof value === "object") {
      parts.push(formEncode(value as Record<string, unknown>, name));
    } else {
      parts.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`);
    }
  }
  // An empty nested object contributes an empty string; dropping those keeps
  // `&&` out of the body, which Stripe reads as an empty parameter name.
  return parts.filter((part) => part !== "").join("&");
}

interface StripeRequest {
  method: "GET" | "POST";
  path: string;
  body?: Record<string, unknown>;
  query?: Record<string, string>;
  /**
   * Stripe deduplicates a retried POST carrying the same key for 24 hours.
   *
   * Required on every write in this module — see the header. It is the
   * caller's to choose because only the caller knows what "the same request"
   * means: for a customer it is the account id, for a checkout it is the
   * account and the plan and the hour, for a Price it is the lookup key.
   */
  idempotencyKey?: string;
}

/**
 * One call to Stripe.
 *
 * **Every non-2xx becomes a `StripeApiError` with Stripe's own code on it.**
 * The code is what callers branch on (`resource_missing` is an ordinary answer
 * to "does this Price exist", a 500 is not), and it is the only part of the
 * response worth preserving in a type.
 */
export async function stripeRequest<T>(request: StripeRequest): Promise<T> {
  const { secretKey } = billingConfig();
  const query =
    request.query === undefined ? "" : `?${new URLSearchParams(request.query).toString()}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${secretKey}`,
    "Stripe-Version": STRIPE_API_VERSION,
  };
  if (request.idempotencyKey !== undefined) {
    headers["Idempotency-Key"] = request.idempotencyKey;
  }
  if (request.method === "POST") {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
  }

  const response = await fetch(`${STRIPE_API}${request.path}${query}`, {
    method: request.method,
    headers,
    body: request.method === "POST" ? formEncode(request.body ?? {}) : undefined,
    // Stripe is never a cached read; a subscription's status is the one thing
    // here that must not be a minute old.
    cache: "no-store",
  });

  const text = await response.text();
  if (!response.ok) {
    let code: string | null = null;
    let message = `Stripe ${request.method} ${request.path} failed with ${response.status}`;
    try {
      const parsed = JSON.parse(text) as { error?: { code?: string; message?: string } };
      code = parsed.error?.code ?? null;
      if (typeof parsed.error?.message === "string") message = `${message}: ${parsed.error.message}`;
    } catch {
      // A non-JSON body from Stripe means an infrastructure error rather than
      // an API one. The status is the whole of what it tells us, and the raw
      // body is deliberately not interpolated into the message: it can be an
      // HTML error page, and this string reaches logs.
    }
    throw new StripeApiError(response.status, code, message);
  }
  return JSON.parse(text) as T;
}

// ─── The response shapes this module actually reads ───
//
// **Declared, not imported, and narrow on purpose.** Each of these is the
// subset of a Stripe object that one function here touches. A generated set of
// full types would be thousands of lines describing fields nothing reads, and
// the narrow version documents the coupling: everything below is a field this
// product depends on Stripe continuing to send.

export interface StripeCustomer {
  id: string;
}

export interface StripeCheckoutSession {
  id: string;
  url: string | null;
  customer: string | null;
  subscription: string | null;
  client_reference_id: string | null;
  status: string | null;
}

export interface StripePortalSession {
  url: string;
}

export interface StripePrice {
  id: string;
  active: boolean;
  currency: string;
  unit_amount: number | null;
  lookup_key: string | null;
  recurring: { interval: string } | null;
}

export interface StripeSubscriptionItem {
  price: StripePrice | null;
}

export interface StripeSubscription {
  id: string;
  customer: string;
  status: string;
  cancel_at_period_end: boolean;
  /**
   * Seconds since the epoch, as Stripe sends every timestamp.
   *
   * On the API version this module pins, the period bounds moved off the
   * subscription and onto its items — so this is read from the item when the
   * subscription itself does not carry it. `periodEndOf` in `webhook.ts` is
   * the one place that reconciliation happens.
   */
  current_period_end?: number | null;
  items?: { data: Array<StripeSubscriptionItem & { current_period_end?: number | null }> };
  metadata?: Record<string, string>;
}

export interface StripeList<T> {
  data: T[];
}

/** Create a customer for an account, or return the one an earlier call made. */
export async function createCustomer(input: {
  userId: string;
  email: string | null;
}): Promise<StripeCustomer> {
  return stripeRequest<StripeCustomer>({
    method: "POST",
    path: "/customers",
    body: {
      email: input.email ?? undefined,
      // **The account id travels with the customer.** It is what makes a
      // Stripe dashboard row answerable back to an account without a lookup
      // table, and what a support question starts from.
      metadata: { userId: input.userId },
    },
    // One customer per account, forever. The account id is exactly the right
    // idempotency key: two concurrent first checkouts by the same person
    // produce one customer, which is the defect the header describes.
    idempotencyKey: `customer:${input.userId}`,
  });
}

/** Find the Price carrying a lookup key, active or not. */
export async function findPriceByLookupKey(lookupKey: string): Promise<StripePrice | null> {
  const found = await stripeRequest<StripeList<StripePrice>>({
    method: "GET",
    path: "/prices",
    // `active: "false"` is NOT passed — the default lists both, and a Price
    // someone archived in the dashboard must still be found here so the
    // mismatch is reported rather than papered over with a second Price
    // carrying the same key, which Stripe would refuse anyway.
    query: { lookup_keys: lookupKey, limit: "2" },
  });
  return found.data[0] ?? null;
}

/** Create a recurring monthly Price under a lookup key. */
export async function createPrice(input: {
  lookupKey: string;
  currency: string;
  unitAmount: number;
  productName: string;
}): Promise<StripePrice> {
  return stripeRequest<StripePrice>({
    method: "POST",
    path: "/prices",
    body: {
      currency: input.currency,
      unit_amount: input.unitAmount,
      lookup_key: input.lookupKey,
      // **Flat monthly**, which is all this product sells — usage-based and
      // annual billing are both in M21's *Deliberately not here*.
      recurring: { interval: "month" },
      // `product_data` creates the Product inline. A separate Product per plan
      // version is the honest shape: what a version grants is fixed, so a
      // version IS the thing being sold, and reusing one Product across
      // versions would make the Stripe dashboard's own history unreadable.
      product_data: { name: input.productName },
    },
    idempotencyKey: `price:${input.lookupKey}`,
  });
}

export async function retrieveSubscription(id: string): Promise<StripeSubscription> {
  return stripeRequest<StripeSubscription>({ method: "GET", path: `/subscriptions/${id}` });
}
