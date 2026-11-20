import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/server/db/client";
import { userFactors, users } from "@/server/db/schema";
import type { MfaFactorView } from "@/lib/mfaWire";
import { issueRecoveryCodes } from "./recoveryCodes";
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

/** The sign count and last-used time after a passkey signed. */
export async function recordPasskeyUse(factorId: string, counter: number, now: Date): Promise<void> {
  await db.update(userFactors).set({ counter, lastUsedAt: now }).where(eq(userFactors.id, factorId));
}

/**
 * Stores the passkey. The first factor on an account turns MFA on in the same
 * breath and returns the ten recovery codes, once (M62 D6); a later one returns
 * none. `mfa_enabled_at` is set by a conditional UPDATE, so two first passkeys
 * registered at once cannot both be told they were first.
 *
 * A credential id already on any account fails on the unique index and throws:
 * an authenticator names one credential, whoever owns it.
 */
export async function addPasskey(
  userId: string,
  passkey: VerifiedRegistration,
  now: Date,
): Promise<{ recoveryCodes: string[] | null }> {
  await db.insert(userFactors).values({
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
  const turnedOn = await db
    .update(users)
    .set({ mfaEnabledAt: now })
    .where(and(eq(users.id, userId), isNull(users.mfaEnabledAt)))
    .returning({ id: users.id });
  return { recoveryCodes: turnedOn.length > 0 ? await issueRecoveryCodes(userId, now) : null };
}
