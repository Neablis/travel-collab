// **The operator reset's only door** (M62 D9, D15; gate box *Operator reset*),
// against a real database.
//
// It strips an account of its second step, so a non-admin who reached it could
// take the step off anyone's account. The reason and the tick are the record of
// why it was done, so a reset without them must change nothing. A reset that
// lands clears every factor and code, turns two-step sign-in off, signs out
// every session the account has (the epoch), leaves one `mfa_resets` row naming
// the operator, and tells the account by email.
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { mfaResets, userFactors, userRecoveryCodes, users } from "@/server/db/schema";
import type { Email } from "@/server/email/send";
import { mfaStateFor } from "@/server/mfa/state";

let currentUserId = "";
vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));
// The mail provider is the only other thing replaced: what the account is told
// is under test, and every write is to the real tables.
const sent = vi.hoisted(() => [] as Email[]);
vi.mock("@/server/email/send", () => ({
  sendEmail: async (email: Email) => {
    sent.push(email);
    return { sent: true, id: null };
  },
}));

const { POST } = await import("./route");

beforeEach(() => {
  sent.length = 0;
  vi.stubEnv("PUBLIC_ORIGIN", "https://caesura.example");
});
afterEach(() => {
  vi.unstubAllEnvs();
  currentUserId = "";
});

async function account(options: { admin?: boolean; email?: string | null } = {}): Promise<string> {
  const id = `dev-${randomUUID()}`;
  const now = new Date().toISOString();
  const email = options.email === undefined ? `${id}@example.test` : options.email;
  await db.insert(users).values({ id, email, isAdmin: options.admin ?? false, createdAt: now, updatedAt: now });
  return id;
}

/** An account with two-step sign-in on: a passkey, an authenticator app and one recovery code. */
async function withMfa(options: { email?: string | null } = {}): Promise<string> {
  const id = await account(options);
  const now = new Date();
  await db.update(users).set({ mfaEnabledAt: now }).where(eq(users.id, id));
  await db.insert(userFactors).values([
    { id: randomUUID(), userId: id, kind: "passkey", name: "Phone", credentialId: randomUUID(), publicKey: "pk", counter: 0, createdAt: now },
    { id: randomUUID(), userId: id, kind: "totp", name: "Authenticator app", sealedSecret: "sealed", createdAt: now },
  ]);
  await db.insert(userRecoveryCodes).values({ id: randomUUID(), userId: id, codeHash: randomUUID(), keyVersion: "v1", createdAt: now });
  return id;
}

const reset = (accountId: string, body: unknown) =>
  POST(new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) }), {
    params: Promise.resolve({ accountId }),
  });

const VALID = { reason: "Lost her phone and her recovery codes; asked from her Gmail on 21 Nov.", confirmed: true };

/** Everything a reset changes, so "nothing changed" is one comparison. */
async function stateOf(id: string) {
  const [factors, codes, resets, mfa] = await Promise.all([
    db.select({ id: userFactors.id }).from(userFactors).where(eq(userFactors.userId, id)),
    db.select({ id: userRecoveryCodes.id }).from(userRecoveryCodes).where(eq(userRecoveryCodes.userId, id)),
    db.select().from(mfaResets).where(eq(mfaResets.userId, id)),
    mfaStateFor(id),
  ]);
  return { factors: factors.length, codes: codes.length, resets: resets.length, ...mfa };
}

describe("only an operator can reset", () => {
  it("404s a signed-in non-admin and changes nothing", async () => {
    const target = await withMfa();
    const before = await stateOf(target);
    currentUserId = await account();

    const res = await reset(target, VALID);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not-found" });
    expect(await stateOf(target)).toEqual(before);
    expect(sent).toHaveLength(0);
  });

  it("404s nobody signed in", async () => {
    const target = await withMfa();
    const before = await stateOf(target);
    expect((await reset(target, VALID)).status).toBe(404);
    expect(await stateOf(target)).toEqual(before);
  });
});

describe("a reset needs its reason and its tick", () => {
  it("400s a missing or blank reason and changes nothing", async () => {
    currentUserId = await account({ admin: true });
    const target = await withMfa();
    const before = await stateOf(target);

    for (const body of [{ confirmed: true }, { reason: "   ", confirmed: true }]) {
      const res = await reset(target, body);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "invalid-mfa-reset" });
    }
    expect(await stateOf(target)).toEqual(before);
    expect(sent).toHaveLength(0);
  });

  it("400s a missing or unticked confirmation and changes nothing", async () => {
    currentUserId = await account({ admin: true });
    const target = await withMfa();
    const before = await stateOf(target);

    for (const body of [{ reason: VALID.reason }, { reason: VALID.reason, confirmed: false }]) {
      const res = await reset(target, body);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "invalid-mfa-reset" });
    }
    expect(await stateOf(target)).toEqual(before);
    expect(sent).toHaveLength(0);
  });
});

describe("an operator's reset", () => {
  it("clears the factors and codes, turns two-step off, bumps the epoch, records it and emails the account", async () => {
    const operator = await account({ admin: true });
    currentUserId = operator;
    const target = await withMfa({ email: "ana@gmail.com" });
    const before = await stateOf(target);

    const res = await reset(target, VALID);
    expect(res.status).toBe(200);

    const after = await stateOf(target);
    expect(after).toMatchObject({ factors: 0, codes: 0, enabled: false, epoch: before.epoch + 1, resets: 1 });
    const [row] = await db.select().from(mfaResets).where(eq(mfaResets.userId, target));
    expect(row).toMatchObject({ operatorId: operator, reason: VALID.reason, emailConfirmation: "ana@gmail.com" });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "ana@gmail.com", tag: "security-change" });
    expect(sent[0]!.text).toContain("reset");
    // The operator's own browser is not the account's: the email names no device.
    expect(sent[0]!.text).not.toContain("From:");
  });

  it("answers 409 for an account with two-step sign-in off, and 404 for no account", async () => {
    currentUserId = await account({ admin: true });
    const off = await account();
    const res = await reset(off, VALID);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "mfa-not-enabled" });
    expect((await stateOf(off)).resets).toBe(0);

    // The tick attests to an email exchange; with no address there was none to have.
    const unreachable = await withMfa({ email: null });
    const noEmail = await reset(unreachable, VALID);
    expect(noEmail.status).toBe(409);
    expect(await noEmail.json()).toEqual({ error: "no-email-on-account" });
    expect((await stateOf(unreachable)).factors).toBe(2);

    const nobody = await reset(`dev-${randomUUID()}`, VALID);
    expect(nobody.status).toBe(404);
    expect(await nobody.json()).toEqual({ error: "no-such-account" });
    expect(sent).toHaveLength(0);
  });
});
