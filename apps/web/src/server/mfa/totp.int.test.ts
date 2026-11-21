import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import * as OTPAuth from "otpauth";
import { db } from "@/server/db/client";
import { userFactors, users } from "@/server/db/schema";
import { addTotp } from "./factors";
import { confirmTotp, startTotp, verifyTotp } from "./totp";

const T0 = new Date("2026-11-20T12:00:30Z");
const seconds = (n: number) => new Date(T0.getTime() + n * 1000);

async function account(): Promise<string> {
  const id = `dev-${randomUUID()}`;
  const now = new Date().toISOString();
  await db.insert(users).values({ id, createdAt: now, updatedAt: now });
  return id;
}

/** What an authenticator app shows for `base32` at `at`: the test's own copy of RFC 6238. */
const codeFor = (base32: string, at: Date) =>
  new OTPAuth.TOTP({ algorithm: "SHA1", digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(base32) }).generate({
    timestamp: at.getTime(),
  });

/** An account with one authenticator app, enrolled as the routes do. */
async function enrolled() {
  const userId = await account();
  const { ticket, secret } = await startTotp(userId, "a@example.test", T0);
  const confirmed = confirmTotp(userId, ticket, codeFor(secret, T0), T0)!;
  await addTotp(userId, confirmed, T0);
  return { userId, secret, factorId: confirmed.factorId, ticket };
}

describe("an authenticator app's secret", () => {
  it("is stored sealed, never as the base32 the person scanned", async () => {
    const { factorId, secret } = await enrolled();
    const [row] = await db.select().from(userFactors).where(eq(userFactors.id, factorId));
    expect(row!.sealedSecret).toMatch(/^v1\./);
    expect(row!.sealedSecret).not.toContain(secret);
  });

  it("stops opening when the sealed value is copied onto another row", async () => {
    const { userId, secret, factorId } = await enrolled();
    const [row] = await db.select().from(userFactors).where(eq(userFactors.id, factorId));
    const copyId = randomUUID();
    await db.delete(userFactors).where(eq(userFactors.id, factorId));
    await db.insert(userFactors).values({ ...row!, id: copyId });
    // The same bytes, a different row id: GCM refuses, so no code matches.
    expect(await verifyTotp(userId, codeFor(secret, seconds(300)), seconds(300))).toBeNull();
  });
});

describe("enrolling", () => {
  it("refuses a ticket from another account, an expired one and a wrong code", async () => {
    const userId = await account();
    const { ticket, secret } = await startTotp(userId, "a@example.test", T0);
    expect(confirmTotp(await account(), ticket, codeFor(secret, T0), T0)).toBeNull();
    expect(confirmTotp(userId, ticket, codeFor(secret, seconds(11 * 60)), seconds(11 * 60))).toBeNull();
    expect(confirmTotp(userId, ticket, "000000", T0)).toBeNull();
    expect(confirmTotp(userId, ticket, codeFor(secret, T0), T0)).not.toBeNull();
  });
});

describe("signing in with a code", () => {
  it("accepts the current code once, and refuses the same time step again", async () => {
    const { userId, secret } = await enrolled();
    // 90 seconds on, so the enrolment code's own step is behind us.
    const at = seconds(90);
    const code = codeFor(secret, at);
    expect(await verifyTotp(userId, code, at)).not.toBeNull();
    expect(await verifyTotp(userId, code, at)).toBeNull();
    // Still the same step a few seconds later.
    expect(await verifyTotp(userId, code, seconds(95))).toBeNull();
  });

  it("refuses the code that enrolled the app", async () => {
    const { userId, secret } = await enrolled();
    expect(await verifyTotp(userId, codeFor(secret, T0), T0)).toBeNull();
  });

  it("forgives one step of clock drift and no more", async () => {
    const { userId, secret } = await enrolled();
    expect(await verifyTotp(userId, codeFor(secret, seconds(60 - 30)), seconds(60 + 5))).not.toBeNull();
    expect(await verifyTotp(userId, codeFor(secret, seconds(120)), seconds(120 + 70))).toBeNull();
  });

  it("lets two simultaneous requests carrying one code win once", async () => {
    const { userId, secret } = await enrolled();
    const at = seconds(150);
    const code = codeFor(secret, at);
    const results = await Promise.all([verifyTotp(userId, code, at), verifyTotp(userId, code, at)]);
    expect(results.filter((r) => r !== null)).toHaveLength(1);
  });

  it("never matches another account's app", async () => {
    const mine = await enrolled();
    const theirs = await enrolled();
    const at = seconds(200);
    expect(await verifyTotp(mine.userId, codeFor(theirs.secret, at), at)).toBeNull();
  });
});
