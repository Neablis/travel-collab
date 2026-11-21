import { randomUUID } from "node:crypto";
import { and, asc, count, eq, isNull } from "drizzle-orm";
import { db } from "@/server/db/client";
import { userFactors, userRecoveryCodes, users } from "@/server/db/schema";
import type { MfaFactorView } from "@/lib/mfaWire";
import { issueRecoveryCodes } from "./recoveryCodes";
import { bumpSecurityEpoch } from "./state";
import type { StoredPasskey, VerifiedRegistration } from "./passkey";
import { AUTHENTICATOR_NAME, type ConfirmedTotp } from "./totp";

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

/** Recovery codes not yet spent, for "N of 10 left". */
export async function recoveryCodesLeft(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(userRecoveryCodes)
    .where(and(eq(userRecoveryCodes.userId, userId), isNull(userRecoveryCodes.usedAt)));
  return row?.n ?? 0;
}

/**
 * What the first factor on an account does, whichever kind it is: turns MFA on,
 * bumps the security epoch and returns the ten recovery codes, once (M62 D6); a
 * later one returns none. The bump is what reaches the account's other
 * open sessions: their tokens say MFA is off, and only an older epoch gets them
 * refused and sent to sign in again. `mfa_enabled_at` is set by a conditional
 * UPDATE, so two first factors added at once cannot both be told they were first.
 */
async function turnOnWithFirstFactor(userId: string, now: Date): Promise<{ recoveryCodes: string[] | null }> {
  const turnedOn = await db
    .update(users)
    .set({ mfaEnabledAt: now })
    .where(and(eq(users.id, userId), isNull(users.mfaEnabledAt)))
    .returning({ id: users.id });
  if (turnedOn.length === 0) return { recoveryCodes: null };
  await bumpSecurityEpoch(userId);
  return { recoveryCodes: await issueRecoveryCodes(userId, now) };
}

/**
 * Stores the passkey and, if it is the account's first factor, turns two-step
 * sign-in on (`turnOnWithFirstFactor`).
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
  return turnOnWithFirstFactor(userId, now);
}

/**
 * Stores a confirmed authenticator app, with the step its enrolment code used
 * already spent so that code cannot also sign anyone in. Throws on a repeated
 * ticket: the row id is the ticket's, so a second confirm hits the primary key.
 */
export async function addTotp(userId: string, totp: ConfirmedTotp, now: Date): Promise<{ recoveryCodes: string[] | null }> {
  await db.insert(userFactors).values({
    id: totp.factorId,
    userId,
    kind: "totp",
    name: AUTHENTICATOR_NAME,
    sealedSecret: totp.sealedSecret,
    lastUsedStep: totp.step,
    createdAt: now,
  });
  return turnOnWithFirstFactor(userId, now);
}
