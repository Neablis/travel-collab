// **The Stripe test-mode switch's only door** (ADR-076 §6, M47's gate box
// *"the switch cannot be read or set by a non-admin"*), against a real database.
//
// The switch lets a test card confer a plan, so a non-admin who could set it
// would hold a free-premium switch. Both directions are checked: a non-admin
// can neither read it nor set it, and the account it belongs to never sees it.
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { upsertUser } from "@/server/users";
import { adminAccountDetail } from "@/server/admin/accountDetail";
import { billingModeFor } from "@/server/billing/testMode";
import { fakeStripeKey, otherFakeStripeKey } from "@/test-support/stripeSignature";

let currentUserId = "";
vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

const { GET, PUT } = await import("./route");
const { GET: ACCOUNT_PLAN } = await import("@/app/api/account/plan/route");

async function account(options: { admin?: boolean } = {}): Promise<string> {
  const id = `dev-${randomUUID()}`;
  await upsertUser({ id, email: `${id}@example.test`, name: null, image: null });
  await db.update(users).set({ isAdmin: options.admin ?? false }).where(eq(users.id, id));
  return id;
}

const switchOf = async (id: string) =>
  (await db.select({ on: users.stripeTestMode }).from(users).where(eq(users.id, id)))[0]!.on;

const params = (accountId: string) => ({ params: Promise.resolve({ accountId }) });
const read = (accountId: string) => GET(new Request("http://localhost/x"), params(accountId));
const put = (accountId: string, body: unknown) =>
  PUT(new Request("http://localhost/x", { method: "PUT", body: JSON.stringify(body) }), params(accountId));

/** Live primary pair with a test pair beside it: production after the M47 walk's setup. */
function bothPairs() {
  vi.stubEnv("STRIPE_SECRET_KEY", fakeStripeKey("sk_live"));
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", fakeStripeKey("whsec"));
  vi.stubEnv("STRIPE_TEST_SECRET_KEY", fakeStripeKey("sk_test"));
  vi.stubEnv("STRIPE_TEST_WEBHOOK_SECRET", otherFakeStripeKey("whsec"));
}

/** Live keys only: production before the walk's setup. */
function liveOnly() {
  vi.stubEnv("STRIPE_SECRET_KEY", fakeStripeKey("sk_live"));
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", fakeStripeKey("whsec"));
  vi.stubEnv("STRIPE_TEST_SECRET_KEY", "");
  vi.stubEnv("STRIPE_TEST_WEBHOOK_SECRET", "");
}

afterEach(() => {
  vi.unstubAllEnvs();
  currentUserId = "";
});

describe("a non-admin can neither read nor set the switch", () => {
  it("404s a signed-in non-admin's GET and PUT, and the column is unchanged", async () => {
    bothPairs();
    const target = await account();
    currentUserId = await account();

    const got = await read(target);
    expect(got.status).toBe(404);
    expect(await got.json()).toEqual({ error: "not-found" });
    const set = await put(target, { enabled: true });
    expect(set.status).toBe(404);
    expect(await set.json()).toEqual({ error: "not-found" });
    expect(await switchOf(target)).toBe(false);
  });

  it("404s an account setting its own switch", async () => {
    bothPairs();
    currentUserId = await account();
    expect((await put(currentUserId, { enabled: true })).status).toBe(404);
    expect(await switchOf(currentUserId)).toBe(false);
  });

  it("404s nobody signed in", async () => {
    bothPairs();
    const target = await account();
    expect((await read(target)).status).toBe(404);
    expect((await put(target, { enabled: true })).status).toBe(404);
    expect(await switchOf(target)).toBe(false);
  });
});

describe("an admin's switch", () => {
  it("sets it, reads it back, and turns it off again", async () => {
    bothPairs();
    currentUserId = await account({ admin: true });
    const target = await account();

    expect(await (await read(target)).json()).toEqual({ enabled: false, available: true });
    const on = await put(target, { enabled: true });
    expect(on.status).toBe(200);
    expect(await on.json()).toEqual({ enabled: true, available: true });
    expect(await (await read(target)).json()).toEqual({ enabled: true, available: true });
    expect(await switchOf(target)).toBe(true);

    expect((await put(target, { enabled: false })).status).toBe(200);
    expect(await switchOf(target)).toBe(false);
  });

  it("answers 409 test-mode-unavailable when no test pair is configured, and changes nothing", async () => {
    liveOnly();
    currentUserId = await account({ admin: true });
    const target = await account();
    expect(await (await read(target)).json()).toEqual({ enabled: false, available: false });
    const res = await put(target, { enabled: true });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "test-mode-unavailable" });
    expect(await switchOf(target)).toBe(false);
  });

  // A switch left on after its pair was removed must still be turnable off.
  it("turns it off with no test pair configured", async () => {
    liveOnly();
    currentUserId = await account({ admin: true });
    const target = await account();
    await db.update(users).set({ stripeTestMode: true }).where(eq(users.id, target));
    expect((await put(target, { enabled: false })).status).toBe(200);
    expect(await switchOf(target)).toBe(false);
  });

  it("answers 404 no-such-account for an account that does not exist", async () => {
    bothPairs();
    currentUserId = await account({ admin: true });
    const nobody = `dev-${randomUUID()}`;
    expect(await (await read(nobody)).json()).toEqual({ error: "no-such-account" });
    const res = await put(nobody, { enabled: true });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "no-such-account" });
  });

  it("answers 400 invalid-test-mode for a body that is not a boolean switch", async () => {
    bothPairs();
    currentUserId = await account({ admin: true });
    const target = await account();
    const res = await put(target, { enabled: "true" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid-test-mode" });
    expect(await switchOf(target)).toBe(false);
  });
});

describe("the mode a switched account checks out in", () => {
  it("is test with the switch on and a test pair configured, live otherwise", async () => {
    bothPairs();
    const target = await account();
    expect(await billingModeFor(target)).toBe("live");
    await db.update(users).set({ stripeTestMode: true }).where(eq(users.id, target));
    expect(await billingModeFor(target)).toBe("test");
    liveOnly();
    expect(await billingModeFor(target)).toBe("live");
  });
});

// **The account never learns it is switched.** What it can read about its own
// plan is `/api/account/plan`; the console's account page is admin-only, and
// its detail read carries no switch either (the toggle's state is its own prop).
describe("the switch reaches no payload the account reads", () => {
  it("is absent from /api/account/plan and the account detail for a switched account", async () => {
    bothPairs();
    const target = await account();
    await db.update(users).set({ stripeTestMode: true }).where(eq(users.id, target));
    const TEST_MODE_KEY = /test.?mode/i;

    currentUserId = target;
    const own = await ACCOUNT_PLAN();
    expect(own.status).toBe(200);
    expect(JSON.stringify(await own.json())).not.toMatch(TEST_MODE_KEY);
    expect(JSON.stringify(await adminAccountDetail(target))).not.toMatch(TEST_MODE_KEY);
  });
});
