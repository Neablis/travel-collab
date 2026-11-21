import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull, lt, lte, or, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { userFactors, users } from "@/server/db/schema";
import type { MfaFactorView } from "@/lib/mfaWire";
import { issueRecoveryCodes } from "./recoveryCodes";
import { bumpSecurityEpoch } from "./state";
import type { StoredPasskey, VerifiedRegistration } from "./passkey";

/** What the Security tab lists: names and times, never a key. */
export async function listFactors(userId: string): Promise<MfaFactorView[]> {
  const rows = await db
    .select({
      id: userFactors.id,
      name: userFactors.name,
      kind: userFactors.kind,
      createdAt: userFactors.createdAt,
      lastUsedAt: userFactors.lastUsedAt,
    })
    .from(userFactors)
    .where(eq(userFactors.userId, userId))
    .orderBy(asc(userFactors.createdAt));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    createdAt: r.createdAt.toISOString(),
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
  }));
}

/** The account's passkeys with the key material a WebAuthn ceremony needs; rows missing it are skipped. */
export async function passkeysOf(userId: string): Promise<StoredPasskey[]> {
  const rows = await db
    .select()
    .from(userFactors)
    .where(and(eq(userFactors.userId, userId), eq(userFactors.kind, "passkey")));
  return rows.flatMap((r) =>
    r.credentialId === null || r.publicKey === null
      ? []
      : [
          {
            id: r.id,
            credentialId: r.credentialId,
            publicKey: r.publicKey,
            counter: r.counter ?? 0,
            transports: r.transports,
          },
        ],
  );
}

/** False when the account has no such factor: a name can only be changed on your own. */
export async function renameFactor(userId: string, factorId: string, name: string): Promise<boolean> {
  const renamed = await db
    .update(userFactors)
    .set({ name })
    .where(and(eq(userFactors.id, factorId), eq(userFactors.userId, userId)))
    .returning({ id: userFactors.id });
  return renamed.length > 0;
}

/**
 * The sign count and last-used time after a passkey signed, in one conditional
 * UPDATE that is also the check. False when the count would go down (two
 * assertions racing, the later write carrying the lower count) or when the
 * challenge was issued before the passkey's last use, which is what makes a
 * challenge single use (`passkey.ts`, *Challenges are not stored*). Equal counts
 * pass: a synced passkey signs 0 forever, and the library has already refused an
 * equal count from one that keeps a count.
 */
export async function recordPasskeyUse(factorId: string, counter: number, issuedAt: number, now: Date): Promise<boolean> {
  const used = await db
    .update(userFactors)
    .set({ counter, lastUsedAt: now })
    .where(
      and(
        eq(userFactors.id, factorId),
        lte(sql`coalesce(${userFactors.counter}, 0)`, counter),
        or(isNull(userFactors.lastUsedAt), lt(userFactors.lastUsedAt, new Date(issuedAt))),
      ),
    )
    .returning({ id: userFactors.id });
  return used.length > 0;
}

/**
 * Stores the passkey. The first factor on an account turns MFA on in the same
 * breath, bumps the security epoch and returns the ten recovery codes, once
 * (M62 D6); a later one returns none. The bump is what reaches the account's other
 * open sessions: their tokens say MFA is off, and only an older epoch gets them
 * refused and sent to sign in again. `mfa_enabled_at` is set by a conditional UPDATE, so two first passkeys
 * registered at once cannot both be told they were first.
 *
 * It is one transaction, so a failure at any step leaves no factor and MFA off,
 * rather than a factor with no codes or codes with MFA off. A credential id
 * already on any account fails on the unique index and throws (`isUniqueViolation`):
 * an authenticator names one credential, whoever owns it.
 */
export async function addPasskey(
  userId: string,
  passkey: VerifiedRegistration,
  now: Date,
): Promise<{ recoveryCodes: string[] | null }> {
  return db.transaction(async (tx) => {
    await tx.insert(userFactors).values({
      id: randomUUID(),
      userId,
      kind: "passkey",
      name: passkey.name,
      credentialId: passkey.credentialId,
      publicKey: passkey.publicKey,
      counter: passkey.counter,
      transports: passkey.transports,
      createdAt: now,
    });
    const turnedOn = await tx
      .update(users)
      .set({ mfaEnabledAt: now })
      .where(and(eq(users.id, userId), isNull(users.mfaEnabledAt)))
      .returning({ id: users.id });
    if (turnedOn.length === 0) return { recoveryCodes: null };
    await bumpSecurityEpoch(userId, tx);
    return { recoveryCodes: await issueRecoveryCodes(userId, now, tx) };
  });
}
