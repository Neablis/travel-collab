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

/**
 * **A Stripe object id, proven to be one before it reaches a URL.**
 *
 * CodeQL flagged `stripeRequest`'s `fetch` as server-side request forgery on
 * PR #177: the URL depends on a user-provided value, because a subscription id
 * arrives on a webhook body and lands in `/subscriptions/${id}`. The host is a
 * constant and a path cannot move it, so the reachable damage is path
 * traversal inside `api.stripe.com` rather than a request to somewhere else —
 * but "the attacker cannot reach another host" is a weaker guarantee than "the
 * value is not attacker-shaped at all", and this is the cheaper one to hold.
 *
 * Stripe ids are `[A-Za-z0-9_]` with a type prefix. Anything else is refused
 * before a request is built, and what passes is encoded anyway: two defences
 * where the second is free.
 *
 * **Refused loudly rather than encoded quietly.** An id that is not one means
 * either Stripe changed its format or somebody is probing, and both are worth
 * an error rather than a 404 from a URL-encoded oddity.
 */
export function stripeId(value: string, what: string): string {
  if (!/^[A-Za-z0-9_]{1,255}$/.test(value)) {
    throw new StripeApiError(
      400,
      "invalid-id",
      `Refusing to build a Stripe URL from a ${what} that is not a Stripe id. ` +
        `Ids are letters, digits and underscores; this one is not, so it is either a Stripe ` +
        `format change or a probe.`,
    );
  }
  return encodeURIComponent(value);
}

/**
 * How long any one Stripe call may take.
 *
 * `fetch` has no timeout of its own, so a stalled connection holds the route
 * open until the platform kills it — and on the webhook that means Stripe's own
 * delivery timing out and retrying against a request we are still making.
 * Fifteen seconds is well past Stripe's normal latency and well inside every
 * platform's function limit.
 */
const STRIPE_TIMEOUT_MS = 15_000;

// Pinned, because Stripe's response shapes change with it and this module
// reads specific fields. An unpinned client gets whatever version the account's
// dashboard is set to, which can be changed by a person who is not deploying
// this code.
const STRIPE_API_VERSION = "2025-08-27.basil";

/** Stripe answered, and what it said was an error. */
export class StripeApiError extends Error {
  readonly status: number;
  readonly stripeCode: string | null;

  constructor(status: number, stripeCode: string | null, message: string) {
    super(message);
    this.status = status;
    this.stripeCode = stripeCode;
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

  // **Bounded, and cleaned up on every path.** `AbortSignal.timeout` would be
  // shorter; an explicit controller is used so the `finally` can clear the
  // timer rather than leaving one pending per call on a busy route.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STRIPE_TIMEOUT_MS);
  let response: Response;
  // **Read inside the `try`, so the timeout covers the BODY too.** `fetch`
  // resolves as soon as Stripe sends response headers, so clearing the timer
  // before `.text()` left a stalled body with no bound at all — the exact
  // failure the timeout exists to prevent, moved one step later. CodeRabbit,
  // PR #177.
  let text: string;
  try {
    response = await fetch(`${STRIPE_API}${request.path}${query}`, {
      method: request.method,
      headers,
      body: request.method === "POST" ? formEncode(request.body ?? {}) : undefined,
      // Stripe is never a cached read; a subscription's status is the one thing
      // here that must not be a minute old.
      cache: "no-store",
      signal: controller.signal,
    });
    text = await response.text();
  } catch (error) {
    // A timeout reaches callers as an ordinary Stripe failure rather than a
    // bare `AbortError`, so the webhook's 500-and-retry path handles it the
    // same way it handles Stripe being down — which is what it is.
    if (error instanceof Error && error.name === "AbortError") {
      throw new StripeApiError(
        504,
        "timeout",
        `Stripe ${request.method} ${request.path} did not answer within ${STRIPE_TIMEOUT_MS}ms.`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

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
  id: string;
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

/**
 * Find the Price carrying a lookup key — **including an archived one**.
 *
 * The first version passed only `lookup_keys` and a comment claiming the
 * default lists both. That was an assumption about somebody else's API, and
 * the failure it buys is specific: an archived Price under our key reads as
 * ABSENT, so `stripePriceFor` tries to create a second one, Stripe refuses it
 * (lookup keys are unique per account), and a checkout fails at the till for a
 * reason nothing in our logs explains.
 *
 * Both listings are made rather than trusting either default, and the results
 * are merged. It is one extra call on a path that runs once per published
 * price, and it replaces a guess with an answer.
 */
// **`lookup_keys[]`, with the brackets.** Stripe types this parameter as an
// array and answers `400: Invalid array` to a scalar rather than reading it as
// a one-element list — so the brackets are the difference between a checkout
// and a 500, not a style choice. Sent without them, this took down every paid
// path in production on 2026-09-16: first purchase and plan change alike, since
// both reach here through `stripePriceFor`. `retrieveSubscriptionWithItems`
// below already spelled its `expand[]` correctly, which is why the symptom was
// confined to price resolution. `stripeApi.test.ts` pins both.
export async function findPriceByLookupKey(lookupKey: string): Promise<StripePrice | null> {
  const [active, archived] = await Promise.all([
    stripeRequest<StripeList<StripePrice>>({
      method: "GET",
      path: "/prices",
      query: { "lookup_keys[]": lookupKey, active: "true", limit: "2" },
    }),
    stripeRequest<StripeList<StripePrice>>({
      method: "GET",
      path: "/prices",
      query: { "lookup_keys[]": lookupKey, active: "false", limit: "2" },
    }),
  ]);
  // Active first: if both somehow exist, the live one is the one being sold.
  return active.data[0] ?? archived.data[0] ?? null;
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
  return stripeRequest<StripeSubscription>({
    method: "GET",
    path: `/subscriptions/${stripeId(id, "subscription id")}`,
  });
}

/** One line of an invoice or of a preview of one. */
export interface StripeInvoiceLine {
  description: string | null;
  amount: number;
  currency: string;
  /** True for the credit half of a proration. */
  proration?: boolean;
}

export interface StripeInvoicePreview {
  amount_due: number;
  currency: string;
  lines: StripeList<StripeInvoiceLine>;
}

export interface StripePaymentMethodCard {
  brand: string;
  last4: string;
}

export interface StripePaymentMethod {
  id: string;
  card: StripePaymentMethodCard | null;
}

/**
 * **What Stripe would charge for this change, without making it.**
 *
 * The confirm step's every figure (SPEC §29): *"in a build every figure comes
 * from Stripe's preview of the change against the plan version being bought;
 * none of it is computed from a price string in the UI."* A preview is a read —
 * it creates no invoice and charges nothing — which is what makes it safe to
 * run on a page load.
 */
export async function previewSubscriptionChange(input: {
  customerId: string;
  subscriptionId: string;
  subscriptionItemId: string;
  priceId: string;
}): Promise<StripeInvoicePreview> {
  return stripeRequest<StripeInvoicePreview>({
    method: "POST",
    path: "/invoices/create_preview",
    body: {
      customer: input.customerId,
      subscription: input.subscriptionId,
      subscription_details: {
        items: [{ id: input.subscriptionItemId, price: input.priceId }],
        // **Prorated to the day**, which is what the chooser's own line promises
        // the reader before they ever reach this step.
        proration_behavior: "create_prorations",
      },
    },
  });
}

/**
 * Move an existing subscription onto another Price, or schedule its end.
 *
 * **This writes nothing locally.** Stripe answers with the updated
 * subscription and sends the event that the webhook applies; reading the
 * response here and writing the row from it would be a second writer, and the
 * two would disagree the first time an event arrived out of order.
 */
export async function updateSubscription(
  subscriptionId: string,
  body: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<StripeSubscription> {
  return stripeRequest<StripeSubscription>({
    method: "POST",
    path: `/subscriptions/${stripeId(subscriptionId, "subscription id")}`,
    body,
    idempotencyKey,
  });
}

/** The subscription with its items expanded, which a change needs the id of. */
export async function retrieveSubscriptionWithItems(id: string): Promise<StripeSubscription> {
  return stripeRequest<StripeSubscription>({
    method: "GET",
    path: `/subscriptions/${stripeId(id, "subscription id")}`,
    query: { "expand[]": "items.data.price" },
  });
}

/** The card a customer has on file, for the confirm step's one honest line. */
export async function defaultPaymentMethod(customerId: string): Promise<StripePaymentMethod | null> {
  const found = await stripeRequest<StripeList<StripePaymentMethod>>({
    method: "GET",
    path: "/payment_methods",
    query: { customer: customerId, type: "card", limit: "1" },
  });
  return found.data[0] ?? null;
}
