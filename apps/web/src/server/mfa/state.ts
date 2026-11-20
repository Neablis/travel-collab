import { eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { digestsMatch, keyedDigest } from "@/server/secrets/keyedDigest";

/** What the session callback needs to know about an account's second factor. */
export interface MfaState {
  enabled: boolean;
  epoch: number;
}

/**
 * One indexed read by primary key. An account with no row reads as off at epoch
 * 0, the same as a token minted before M62 existed: refusing it is
 * `recordSignIn`'s job, not this read's.
 */
export async function mfaStateFor(userId: string): Promise<MfaState> {
  const [row] = await db
    .select({ enabledAt: users.mfaEnabledAt, epoch: users.securityEpoch })
    .from(users)
    .where(eq(users.id, userId));
  return { enabled: row?.enabledAt != null, epoch: row?.epoch ?? 0 };
}

/** Goes up by one and returns the new value: every token minted under the old one is now refused. */
export async function bumpSecurityEpoch(userId: string): Promise<number> {
  const [row] = await db
    .update(users)
    .set({ securityEpoch: sql`${users.securityEpoch} + 1` })
    .where(eq(users.id, userId))
    .returning({ epoch: users.securityEpoch });
  return row?.epoch ?? 0;
}

// What a route hands the client after it verified a factor, so the client can
// give it back to NextAuth's `update`. `POST /api/auth/session` runs the `jwt`
// callback with whatever body the browser sends, so the callback must not believe
// `{ method: "webauthn" }` on its own: it believes this, which only a server that
// checked a factor could have made.
export type SecondFactorMethod = "webauthn" | "otp" | "recovery";

export interface SecondFactorProof {
  method: SecondFactorMethod;
  /** The security epoch the factor was checked under; the new token carries it. */
  epoch: number;
  /** Epoch milliseconds; a proof is good for a couple of minutes. */
  expiresAt: number;
  proof: string;
}

const PROOF_LIFETIME_MS = 2 * 60 * 1000;

// Keyed under the same pepper as every issued secret, with a prefix so a proof
// can never equal a digest of anything else this app stores.
function digestOf(userId: string, method: string, epoch: number, expiresAt: number): string {
  return keyedDigest(`mfa-proof|${userId}|${method}|${epoch}|${expiresAt}`).digest;
}

/** Called by the route that just verified a factor. `now` is injected, never read here. */
export function mintSecondFactorProof(
  userId: string,
  method: SecondFactorMethod,
  epoch: number,
  now: Date,
): SecondFactorProof {
  const expiresAt = now.getTime() + PROOF_LIFETIME_MS;
  return { method, epoch, expiresAt, proof: digestOf(userId, method, epoch, expiresAt) };
}

/** The method the proof vouches for, or null for anything forged, expired, or from an older epoch. */
export function readSecondFactorProof(
  userId: string,
  candidate: unknown,
  currentEpoch: number,
  now: Date,
): SecondFactorMethod | null {
  if (typeof candidate !== "object" || candidate === null) return null;
  const { method, epoch, expiresAt, proof } = candidate as Partial<SecondFactorProof>;
  if (method !== "webauthn" && method !== "otp" && method !== "recovery") return null;
  if (typeof epoch !== "number" || typeof expiresAt !== "number" || typeof proof !== "string") return null;
  if (epoch !== currentEpoch || expiresAt < now.getTime()) return null;
  return digestsMatch(proof, digestOf(userId, method, epoch, expiresAt)) ? method : null;
}
