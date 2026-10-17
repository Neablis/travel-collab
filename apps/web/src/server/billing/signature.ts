// **An unsigned request is rejected before it is parsed** (M21 link 4, and a
// gate box in its own right).
//
// The ordering is the claim, and it is only a claim you can make if you control
// the order — which is the main reason this is thirty lines of `node:crypto`
// rather than an SDK call (ADR-047). `constructStripeEvent` below verifies and
// only then parses, and it is the ONLY way this application turns a webhook
// body into an event: there is no second parse for an attacker's body to reach.
//
// **What the signature buys.** The webhook is the sole writer of subscription
// state, so a request that can forge one can grant itself any plan. Nothing
// else on that endpoint is a control: it is unauthenticated by necessity
// (Stripe has no session), it is public, and its URL is guessable. The HMAC is
// the entire boundary.
//
// **And which Stripe account it came from** (ADR-076 §5). A deployment may hold
// a live and a test signing secret; the body is tried against each, and the one
// that verifies decides the mode. Nothing in the body is believed about it.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { StripeMode } from "./config";

/** The delivery could not be shown to have come from Stripe. */
export class WebhookSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookSignatureError";
  }
}

/**
 * A verified delivery whose own `livemode` disagrees with the secret that
 * verified it, or does not say.
 *
 * **Refused, not recorded as one mode or the other** (ADR-076, *Rejected* 1).
 * Writing it either way makes a row whose mode two sources dispute, and the
 * cause is a configuration mistake — a test-mode endpoint's secret stored in
 * the live pair, say — that a red delivery in Stripe's dashboard shows better
 * than a quiet row.
 * Not a `WebhookSignatureError`: the signature is fine, and the route answers
 * the two differently.
 */
export class WebhookModeMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookModeMismatchError";
  }
}

/** One signing secret this deployment holds, and the mode of the pair it belongs to. */
export interface WebhookSecret {
  mode: StripeMode;
  secret: string;
}

/**
 * How far out of date a delivery may be, in seconds.
 *
 * Stripe's own default, and it is a replay defence rather than a clock
 * pedantry: without it a signature captured once stays valid forever, and the
 * signature is the whole boundary. Five minutes is generous enough for a
 * retry and a slow cold start, and short enough that a captured delivery is
 * useless by the time anyone could use it.
 *
 * It is not the only replay defence — `billing_events` makes a *replay of an
 * event we already applied* a no-op regardless of age — but the two answer
 * different attacks. This one is about a body we have never seen applied.
 */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

interface ParsedHeader {
  timestamp: number;
  signatures: string[];
}

/**
 * `t=1492774577,v1=<hex>,v1=<hex>` — the header Stripe sends.
 *
 * **Several `v1` values is normal, not an attack.** During a signing-secret
 * rotation Stripe signs with both, so a caller that takes only the first would
 * reject half the deliveries for the duration of a rotation — which is a
 * failure that appears once, under time pressure, and looks like Stripe being
 * broken. Every `v1` is a candidate and any one matching is a pass.
 */
function parseSignatureHeader(header: string): ParsedHeader {
  let timestamp = Number.NaN;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t") timestamp = Number(value);
    else if (key === "v1") signatures.push(value);
  }
  if (!Number.isFinite(timestamp) || signatures.length === 0) {
    throw new WebhookSignatureError(
      "Stripe-Signature is malformed: expected a `t=` timestamp and at least one `v1=` signature.",
    );
  }
  return { timestamp, signatures };
}

/**
 * Compare two hex digests without leaking how far they matched.
 *
 * `timingSafeEqual` throws on a length mismatch rather than returning false, so
 * the length is checked first — a `v1` of the wrong length is an ordinary
 * malformed header and must not become a 500. Hex is validated too: a value
 * with a non-hex character decodes to a SHORTER buffer under
 * `Buffer.from(_, "hex")`, which would silently make a wrong-length comparison
 * into a length check that passes.
 */
function digestsMatch(expected: string, candidate: string): boolean {
  if (!/^[0-9a-f]+$/i.test(candidate)) return false;
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(candidate, "hex");
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

/**
 * **Verify, and say nothing about the body** — except which secret signed it.
 *
 * Takes the RAW body as Stripe sent it. Not a re-serialised object: JSON
 * round-tripping reorders keys and drops whitespace, and the HMAC is over
 * bytes, so a verified-after-parse scheme fails for well-formed payloads in a
 * way that looks random. The route reads `await request.text()` and hands that
 * string here untouched.
 *
 * Returns the mode of the first secret any `v1` matches. Live and test secrets
 * are different strings, so at most one can.
 */
export function verifyStripeSignature(input: {
  rawBody: string;
  header: string | null;
  secrets: readonly WebhookSecret[];
  now?: Date;
  toleranceSeconds?: number;
}): StripeMode {
  if (input.header === null || input.header === "") {
    throw new WebhookSignatureError("No Stripe-Signature header.");
  }
  const { timestamp, signatures } = parseSignatureHeader(input.header);

  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const tolerance = input.toleranceSeconds ?? SIGNATURE_TOLERANCE_SECONDS;
  // **Both directions.** A delivery from the future is as suspect as a stale
  // one — it is what a replay with a doctored timestamp looks like when the
  // attacker guesses the skew wrong — and a one-sided check would accept it.
  if (Math.abs(nowSeconds - timestamp) > tolerance) {
    throw new WebhookSignatureError(
      `Stripe-Signature timestamp is ${Math.abs(nowSeconds - timestamp)}s out, and the ` +
        `tolerance is ${tolerance}s. A delivery this far off is a replay or a badly wrong clock.`,
    );
  }

  for (const { mode, secret } of input.secrets) {
    const expected = createHmac("sha256", secret)
      .update(`${timestamp}.${input.rawBody}`, "utf8")
      .digest("hex");
    if (signatures.some((candidate) => digestsMatch(expected, candidate))) return mode;
  }
  throw new WebhookSignatureError("Stripe-Signature does not match the body.");
}

/** The envelope every Stripe event arrives in, narrowed to what is read. */
export interface StripeEvent {
  id: string;
  type: string;
  /** Seconds since the epoch. The ordering comparison's input. */
  created: number;
  /** The body's own word on its mode, checked against the verifying secret's. */
  livemode: boolean;
  data: { object: Record<string, unknown> };
}

/**
 * An event as `constructStripeEvent` hands it on: with the mode of the secret
 * that verified it, which is the mode everything after the route acts in.
 */
export interface VerifiedStripeEvent extends StripeEvent {
  mode: StripeMode;
}

/**
 * **The only way a webhook body becomes an event in this application.**
 *
 * Verify first, parse second, and there is deliberately no other parse for an
 * unverified body to reach — which is what makes the gate box's ordering claim
 * provable rather than asserted. `signature.test.ts` proves it the only way it
 * can be proved from outside: hand this an unparseable body AND a bad
 * signature, and the error it raises is the signature's.
 */
export function constructStripeEvent(input: {
  rawBody: string;
  header: string | null;
  secrets: readonly WebhookSecret[];
  now?: Date;
  toleranceSeconds?: number;
}): VerifiedStripeEvent {
  const mode = verifyStripeSignature(input);

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.rawBody);
  } catch {
    // Signed by us and not JSON is not an attack; it is a bug at one end or the
    // other, and it gets its own error so the two are never confused in a log.
    throw new WebhookSignatureError("Body is signed but is not JSON.");
  }
  const event = parsed as Partial<StripeEvent>;
  if (
    typeof event.id !== "string" ||
    typeof event.type !== "string" ||
    typeof event.created !== "number" ||
    typeof event.data !== "object" ||
    event.data === null ||
    typeof event.data.object !== "object" ||
    event.data.object === null
  ) {
    throw new WebhookSignatureError("Body is signed but is not a Stripe event envelope.");
  }
  if (event.livemode !== (mode === "live")) {
    throw new WebhookModeMismatchError(
      `Body is signed with the ${mode} pair's webhook secret and says livemode: ` +
        `${String(event.livemode)}. That pair's signing secret may belong to a ` +
        `${mode === "live" ? "test" : "live"}-mode endpoint in Stripe's dashboard.`,
    );
  }
  // Built field by field rather than spread, so a `mode` key in the body cannot
  // stand in for the one the signature gave.
  return {
    id: event.id,
    type: event.type,
    created: event.created,
    livemode: event.livemode,
    data: event.data,
    mode,
  };
}
