import { eq, sql } from "drizzle-orm";
import { db, type Queryable } from "@/server/db/client";
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
export async function bumpSecurityEpoch(userId: string, executor: Queryable = db): Promise<number> {
  const [row] = await executor
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
function digestOf(userId: string, sid: string, method: string, epoch: number, expiresAt: number): string {
  return keyedDigest(`mfa-proof|${userId}|${sid}|${method}|${epoch}|${expiresAt}`).digest;
}

/**
 * Called by the route that just verified a factor. `sid` is the session's own id
 * (`token.sid`), so the proof is good for the cookie that asked and no other.
 * `now` is injected, never read here.
 */
export function mintSecondFactorProof(
  userId: string,
  sid: string,
  method: SecondFactorMethod,
  epoch: number,
  now: Date,
): SecondFactorProof {
  const expiresAt = now.getTime() + PROOF_LIFETIME_MS;
  return { method, epoch, expiresAt, proof: digestOf(userId, sid, method, epoch, expiresAt) };
}

/**
 * What the proof vouches for, or null for anything forged, expired, from an older
 * epoch or minted for another session. Single use is the caller's: it keeps the
 * `expiresAt` it accepted and refuses one that is not later (`authConfig.ts`).
 */
export function readSecondFactorProof(
  userId: string,
  sid: string,
  candidate: unknown,
  currentEpoch: number,
  now: Date,
): { method: SecondFactorMethod; expiresAt: number } | null {
  if (typeof candidate !== "object" || candidate === null) return null;
  const { method, epoch, expiresAt, proof } = candidate as Partial<SecondFactorProof>;
  if (method !== "webauthn" && method !== "otp" && method !== "recovery") return null;
  if (typeof epoch !== "number" || typeof expiresAt !== "number" || typeof proof !== "string") return null;
  if (epoch !== currentEpoch || expiresAt < now.getTime()) return null;
  return digestsMatch(proof, digestOf(userId, sid, method, epoch, expiresAt)) ? { method, expiresAt } : null;
}

/** How recent a check must be to add, remove or regenerate (M62 D6). */
export const FRESH_CHECK_MS = 10 * 60 * 1000;

/**
 * Whether the session has proved itself lately: a second factor within ten
 * minutes when the account has MFA on, or a Google sign-in within ten minutes
 * when it is off and there is no second factor to ask for. Judged from what the
 * session carries (`SessionWithMfa`), so it costs no read.
 */
export function hasFreshCheck(
  mfaEnabled: boolean,
  session: { mfaAt?: number; signedInAt?: number },
  now: Date,
): boolean {
  const at = mfaEnabled ? session.mfaAt : session.signedInAt;
  return at !== undefined && now.getTime() - at <= FRESH_CHECK_MS;
}
