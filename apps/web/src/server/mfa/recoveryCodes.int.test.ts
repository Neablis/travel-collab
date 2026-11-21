import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { userRecoveryCodes } from "@/server/db/schema";
import { keyedDigest } from "@/server/secrets/keyedDigest";
import { consumeRecoveryCode, issueRecoveryCodes } from "./recoveryCodes";

const NOW = new Date("2026-11-20T12:00:00Z");
const newUser = () => `dev-${randomUUID()}`;

describe("recovery codes", () => {
  it("issues ten distinct codes and stores none of them in plaintext", async () => {
    const user = newUser();
    const codes = await issueRecoveryCodes(user, NOW);
    expect(new Set(codes).size).toBe(10);
    const rows = await db.select().from(userRecoveryCodes).where(eq(userRecoveryCodes.userId, user));
    expect(rows).toHaveLength(10);
    // Each row is the keyed digest of the code as typed-and-normalised, so a
    // store of the plaintext, dashed or not, cannot pass.
    const stored = new Set(rows.map((r) => r.codeHash));
    for (const code of codes) {
      const digest = keyedDigest(code.toLowerCase().replace(/[^a-z0-9]/g, "")).digest;
      expect(digest).toMatch(/^[0-9a-f]{64}$/);
      expect(stored.has(digest)).toBe(true);
    }
  });

  it("accepts each code once, however it was typed", async () => {
    const user = newUser();
    const [first, second] = await issueRecoveryCodes(user, NOW);
    expect(await consumeRecoveryCode(user, first!.toUpperCase().replace("-", " "), NOW)).toBe(true);
    expect(await consumeRecoveryCode(user, first!, NOW)).toBe(false);
    expect(await consumeRecoveryCode(user, second!, NOW)).toBe(true);
  });

  it("lets only one of two simultaneous attempts spend a code", async () => {
    const user = newUser();
    const [code] = await issueRecoveryCodes(user, NOW);
    const results = await Promise.all([consumeRecoveryCode(user, code!, NOW), consumeRecoveryCode(user, code!, NOW)]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("refuses a code that belongs to another account", async () => {
    const [mine, theirs] = [newUser(), newUser()];
    const [code] = await issueRecoveryCodes(mine, NOW);
    await issueRecoveryCodes(theirs, NOW);
    expect(await consumeRecoveryCode(theirs, code!, NOW)).toBe(false);
  });

  it("voids the whole old set, spent and unspent, when new codes are issued", async () => {
    const user = newUser();
    const old = await issueRecoveryCodes(user, NOW);
    await consumeRecoveryCode(user, old[0]!, NOW);
    const fresh = await issueRecoveryCodes(user, NOW);
    for (const code of old) expect(await consumeRecoveryCode(user, code, NOW)).toBe(false);
    expect(await consumeRecoveryCode(user, fresh[0]!, NOW)).toBe(true);
    const rows = await db.select().from(userRecoveryCodes).where(eq(userRecoveryCodes.userId, user));
    expect(rows).toHaveLength(10);
  });

  it("leaves exactly ten valid codes after two simultaneous regenerations", async () => {
    const user = newUser();
    await Promise.all([issueRecoveryCodes(user, NOW), issueRecoveryCodes(user, NOW)]);
    const rows = await db.select().from(userRecoveryCodes).where(eq(userRecoveryCodes.userId, user));
    expect(rows).toHaveLength(10);
  });
});
