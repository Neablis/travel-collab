import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { fakeStripeKey, otherFakeStripeKey, signStripePayload } from "@/test-support/stripeSignature";
import {
  SIGNATURE_TOLERANCE_SECONDS,
  WebhookModeMismatchError,
  WebhookSignatureError,
  constructStripeEvent,
  verifyStripeSignature,
} from "./signature";

// **The webhook is the sole writer of subscription state, so a request that can
// forge a signature can grant itself any plan.** There is no session, no
// allowlist and no secret URL behind this — the HMAC is the entire boundary,
// which is why this file is longer than the module it tests.

// Built at runtime rather than written as a literal — see `fakeStripeKey`.
// A credential-shaped literal in the source tree is indistinguishable from a
// real one that was committed by accident, which is the exact mistake this
// module exists to make impossible.
const SECRET = fakeStripeKey("whsec");
const TEST_SECRET = otherFakeStripeKey("whsec");
const LIVE_ONLY = [{ mode: "live" as const, secret: SECRET }];
const BOTH = [...LIVE_ONLY, { mode: "test" as const, secret: TEST_SECRET }];
const NOW = new Date("2026-10-01T12:00:00.000Z");

const EVENT = {
  id: "evt_1",
  type: "customer.subscription.updated",
  created: Math.floor(NOW.getTime() / 1000),
  livemode: true,
  data: { object: { id: "sub_1" } },
};
const BODY = JSON.stringify(EVENT);

const signed = (body = BODY, at = NOW, secret = SECRET) => signStripePayload(body, secret, at);

describe("a delivery that did not come from Stripe", () => {
  it.each([
    ["no header at all", null],
    ["an empty header", ""],
    ["a header with no timestamp", "v1=abc"],
    ["a header with no signature", "t=1790000000"],
    ["a header that is not one", "nonsense"],
  ])("is refused when it has %s", (_what, header) => {
    expect(() => verifyStripeSignature({ rawBody: BODY, header, secrets: LIVE_ONLY, now: NOW })).toThrow(
      WebhookSignatureError,
    );
  });

  it("is refused when the signature is for a different body", () => {
    const header = signed(JSON.stringify({ ...EVENT, id: "evt_other" }));
    expect(() => verifyStripeSignature({ rawBody: BODY, header, secrets: LIVE_ONLY, now: NOW })).toThrow(
      WebhookSignatureError,
    );
  });

  it("is refused when it was signed with a different secret", () => {
    const header = signed(BODY, NOW, otherFakeStripeKey("whsec"));
    expect(() => verifyStripeSignature({ rawBody: BODY, header, secrets: LIVE_ONLY, now: NOW })).toThrow(
      WebhookSignatureError,
    );
  });

  // A non-hex `v1` decodes to a SHORTER buffer under `Buffer.from(_, "hex")`,
  // which would turn a wrong-length comparison into a length check that passes.
  // Caught by validating the hex before decoding it.
  it("is refused when the signature is not hex", () => {
    const header = `t=${EVENT.created},v1=zzzz`;
    expect(() => verifyStripeSignature({ rawBody: BODY, header, secrets: LIVE_ONLY, now: NOW })).toThrow(
      WebhookSignatureError,
    );
  });

  // `timingSafeEqual` THROWS on a length mismatch rather than returning false,
  // so a short `v1` would be a 500 instead of a 400 without the length check.
  it("is refused, not crashed, by a signature of the wrong length", () => {
    const header = `t=${EVENT.created},v1=abcd`;
    expect(() => verifyStripeSignature({ rawBody: BODY, header, secrets: LIVE_ONLY, now: NOW })).toThrow(
      WebhookSignatureError,
    );
  });
});

describe("a delivery that did", () => {
  it("is accepted", () => {
    expect(() =>
      verifyStripeSignature({ rawBody: BODY, header: signed(), secrets: LIVE_ONLY, now: NOW }),
    ).not.toThrow();
  });

  // **Several `v1` values is normal during a signing-secret rotation**, when
  // Stripe signs with both. A reader that took only the first would reject half
  // the deliveries for the duration of a rotation — a failure that appears once,
  // under time pressure, and looks like Stripe being broken.
  it("is accepted when one of several signatures matches", () => {
    const timestamp = EVENT.created;
    const good = createHmac("sha256", SECRET).update(`${timestamp}.${BODY}`, "utf8").digest("hex");
    const stale = createHmac("sha256", otherFakeStripeKey("whsec"))
      .update(`${timestamp}.${BODY}`, "utf8")
      .digest("hex");
    expect(() =>
      verifyStripeSignature({
        rawBody: BODY,
        header: `t=${timestamp},v1=${stale},v1=${good}`,
        secrets: LIVE_ONLY,
        now: NOW,
      }),
    ).not.toThrow();
  });
});

describe("the replay window", () => {
  const withinAndOutside = (offsetSeconds: number) =>
    verifyStripeSignature({
      rawBody: BODY,
      header: signed(BODY, new Date(NOW.getTime() + offsetSeconds * 1000)),
      secrets: LIVE_ONLY,
      now: NOW,
    });

  it("accepts a delivery inside the tolerance", () => {
    expect(() => withinAndOutside(-(SIGNATURE_TOLERANCE_SECONDS - 1))).not.toThrow();
  });

  it("refuses one that is too old — a captured signature must expire", () => {
    expect(() => withinAndOutside(-(SIGNATURE_TOLERANCE_SECONDS + 1))).toThrow(WebhookSignatureError);
  });

  // A delivery from the future is what a replay with a doctored timestamp looks
  // like when the attacker guesses the skew wrong, so the check is two-sided.
  it("refuses one from the future", () => {
    expect(() => withinAndOutside(SIGNATURE_TOLERANCE_SECONDS + 1)).toThrow(WebhookSignatureError);
  });
});

describe("the gate box: rejected BEFORE its body is parsed", () => {
  // **The only way to prove an ordering from outside is to make the two steps
  // disagree about the same input.** A body that is not JSON and a signature
  // that does not match: if parsing came first the error would be about JSON,
  // and it is about the signature.
  it("reports the signature, not the parse, for a body that is neither", () => {
    expect(() =>
      constructStripeEvent({ rawBody: "{{{ not json", header: "t=1,v1=ff", secrets: LIVE_ONLY, now: NOW }),
    ).toThrow(/Stripe-Signature/);
  });

  // The other half: signed and unparseable is a different error with a
  // different message, so a log never confuses "someone is poking at us" with
  // "one end of this has a bug".
  it("says so plainly when a body is signed and is not JSON", () => {
    const rawBody = "{{{ not json";
    expect(() =>
      constructStripeEvent({ rawBody, header: signed(rawBody), secrets: LIVE_ONLY, now: NOW }),
    ).toThrow(/signed but is not JSON/);
  });

  it("refuses a signed body that is not an event envelope", () => {
    const rawBody = JSON.stringify({ id: "evt_1", type: "x" });
    expect(() =>
      constructStripeEvent({ rawBody, header: signed(rawBody), secrets: LIVE_ONLY, now: NOW }),
    ).toThrow(/not a Stripe event envelope/);
  });

  it("returns the event when everything holds", () => {
    expect(constructStripeEvent({ rawBody: BODY, header: signed(), secrets: LIVE_ONLY, now: NOW })).toEqual({
      ...EVENT,
      mode: "live",
    });
  });
});

// **The secret that verified decides the mode** (ADR-076 §5). The body's own
// `livemode` is unverified until the signature is, and even then it is a second
// opinion: a delivery whose two answers disagree is refused, because recording
// it either way writes a row whose mode two sources dispute.
describe("the Stripe mode of a delivery", () => {
  const TEST_EVENT = { ...EVENT, livemode: false };
  const TEST_BODY = JSON.stringify(TEST_EVENT);

  it("is test when the test secret verified it", () => {
    const verified = constructStripeEvent({
      rawBody: TEST_BODY,
      header: signed(TEST_BODY, NOW, TEST_SECRET),
      secrets: BOTH,
      now: NOW,
    });
    expect(verified.mode).toBe("test");
  });

  // Only the signature names the mode; a `mode` key in the signed body is data.
  it("ignores a mode key in the body", () => {
    const rawBody = JSON.stringify({ ...TEST_EVENT, mode: "live" });
    const verified = constructStripeEvent({
      rawBody,
      header: signed(rawBody, NOW, TEST_SECRET),
      secrets: BOTH,
      now: NOW,
    });
    expect(verified.mode).toBe("test");
  });

  it("is live when the live secret verified it", () => {
    expect(constructStripeEvent({ rawBody: BODY, header: signed(), secrets: BOTH, now: NOW }).mode).toBe("live");
  });

  it("is refused as a bad signature when neither secret verifies it", () => {
    const header = signed(BODY, NOW, fakeStripeKey("sk_test"));
    expect(() => constructStripeEvent({ rawBody: BODY, header, secrets: BOTH, now: NOW })).toThrow(
      WebhookSignatureError,
    );
    // And still before the parse, with two secrets to try.
    expect(() =>
      constructStripeEvent({ rawBody: "{{{ not json", header, secrets: BOTH, now: NOW }),
    ).toThrow(/Stripe-Signature does not match/);
  });

  // The gate box: *an event signed with the test secret but claiming
  // `livemode: true` is refused*.
  it("is refused when the test secret verified a body that says livemode: true", () => {
    const header = signed(BODY, NOW, TEST_SECRET);
    expect(() => constructStripeEvent({ rawBody: BODY, header, secrets: BOTH, now: NOW })).toThrow(
      WebhookModeMismatchError,
    );
  });

  it("is refused when the live secret verified a body that says livemode: false", () => {
    const header = signed(TEST_BODY, NOW, SECRET);
    expect(() => constructStripeEvent({ rawBody: TEST_BODY, header, secrets: BOTH, now: NOW })).toThrow(
      WebhookModeMismatchError,
    );
  });

  it("is refused when the body does not say its mode at all", () => {
    const rawBody = JSON.stringify({ ...EVENT, livemode: undefined });
    expect(() =>
      constructStripeEvent({ rawBody, header: signed(rawBody), secrets: BOTH, now: NOW }),
    ).toThrow(WebhookModeMismatchError);
  });
});
