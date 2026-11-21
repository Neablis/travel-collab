import { and, count, eq, isNull } from "drizzle-orm";
import { db, type Queryable } from "@/server/db/client";
import { apiTokens, oauthGrants, userFactors, userRecoveryCodes, users } from "@/server/db/schema";
import { deploymentOrigin } from "@/lib/deploymentOrigin";
import { sendEmail } from "@/server/email/send";
import { securityChangeEmail, type SecurityChangeKind } from "@/server/email/templates";
import { clientIp } from "@/server/og/limit";
import { bumpSecurityEpoch, mintSecondFactorProof, type SecondFactorProof } from "./state";

// Every change to how an account is entered after it is on (M62 D7): Remove, Turn
// off and Regenerate. Each runs its own write and the epoch bump in ONE
// transaction, so there is no moment when the factor is gone and the other
// sessions are still good, and each then tells the account by email.

/** Thrown inside the change's transaction, so the write it refused is rolled back with it. */
export class ChangeRefused extends Error {
  readonly reason: "not-found" | "last-factor";
  constructor(reason: "not-found" | "last-factor") {
    super(reason);
    this.reason = reason;
  }
}

/**
 * Removes one of the account's own factors. The last one stays: with two-step
 * sign-in on, removing it would leave an account that asks for a second step it
 * cannot take, and *Turn off* is the way to end that. The user row is locked
 * first, so two removals at once cannot each see another factor still standing.
 */
export async function removeFactorIn(tx: Queryable, userId: string, factorId: string): Promise<void> {
  await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
  const mine = and(eq(userFactors.id, factorId), eq(userFactors.userId, userId));
  const [target] = await tx.select({ id: userFactors.id }).from(userFactors).where(mine);
  if (target === undefined) throw new ChangeRefused("not-found");
  const [row] = await tx.select({ n: count() }).from(userFactors).where(eq(userFactors.userId, userId));
  if ((row?.n ?? 0) <= 1) throw new ChangeRefused("last-factor");
  await tx.delete(userFactors).where(mine);
}

/** Every factor and every recovery code, and two-step sign-in off. */
export async function turnOffIn(tx: Queryable, userId: string): Promise<void> {
  await tx.delete(userFactors).where(eq(userFactors.userId, userId));
  await tx.delete(userRecoveryCodes).where(eq(userRecoveryCodes.userId, userId));
  await tx.update(users).set({ mfaEnabledAt: null }).where(eq(users.id, userId));
}

/**
 * Revokes every API token and every OAuth grant the account holds (the tick on the
 * recovery-codes sheet, D8). Both are the owner's own act, so both carry `owner`.
 */
export async function revokeAllCredentials(userId: string, now: Date): Promise<{ tokens: number; grants: number }> {
  return db.transaction(async (tx) => {
    const tokens = await tx
      .update(apiTokens)
      .set({ revokedAt: now, revokedReason: "owner" })
      .where(and(eq(apiTokens.ownerId, userId), isNull(apiTokens.revokedAt)))
      .returning({ id: apiTokens.id });
    const grants = await tx
      .update(oauthGrants)
      .set({ revokedAt: now, revokedReason: "owner" })
      .where(and(eq(oauthGrants.ownerId, userId), isNull(oauthGrants.revokedAt)))
      .returning({ id: oauthGrants.id });
    return { tokens: tokens.length, grants: grants.length };
  });
}

/**
 * A browser and a system, from a `User-Agent`, and nothing finer: enough for a
 * person to say "that was not my phone", and no version that would single out a
 * device. Null when it names neither.
 */
export function describeClient(userAgent: string | null): string | null {
  if (userAgent === null) return null;
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /OPR\//.test(userAgent)
      ? "Opera"
      : /Firefox\//.test(userAgent)
        ? "Firefox"
        : /Chrome\/|CriOS\//.test(userAgent)
          ? "Chrome"
          : /Safari\//.test(userAgent)
            ? "Safari"
            : null;
  // iOS names "like Mac OS X" too, so it is asked first.
  const system = /iPhone|iPad|iPod/.test(userAgent)
    ? "iOS"
    : /Android/.test(userAgent)
      ? "Android"
      : /Windows/.test(userAgent)
        ? "Windows"
        : /Mac OS X|Macintosh/.test(userAgent)
          ? "macOS"
          : /Linux|X11/.test(userAgent)
            ? "Linux"
            : null;
  if (browser !== null && system !== null) return `${browser} on ${system}`;
  return browser ?? system;
}

/**
 * Runs `apply` and the epoch bump as one transaction, then emails the account and
 * returns the proof that keeps THIS session: the bump signs out every other, and
 * this one hands the proof to NextAuth's `update` to be given a current token
 * (`authConfig.ts`; an `epoch` proof vouches for no factor).
 *
 * The email follows the commit and never fails the change: `sendEmail` does not
 * throw, and an account with no deliverable address simply gets none.
 */
export async function recordSecurityChange<T>(input: {
  userId: string;
  /** The changing session's own id (`token.sid`), which the proof is bound to. */
  sid: string;
  change: SecurityChangeKind;
  request: Request;
  now: Date;
  apply: (tx: Queryable) => Promise<T>;
}): Promise<{ result: T; proof: SecondFactorProof }> {
  const { result, epoch } = await db.transaction(async (tx) => {
    const result = await input.apply(tx);
    return { result, epoch: await bumpSecurityEpoch(input.userId, tx) };
  });

  const [row] = await db.select({ email: users.email }).from(users).where(eq(users.id, input.userId));
  if (row?.email) {
    const ip = clientIp(input.request);
    await sendEmail(
      securityChangeEmail({
        to: row.email,
        change: input.change,
        at: input.now,
        client: describeClient(input.request.headers.get("user-agent")),
        ip: ip === "unknown" ? null : ip,
        securityUrl: `${deploymentOrigin()}/account?tab=security`,
      }),
    );
  }
  return { result, proof: mintSecondFactorProof(input.userId, input.sid, "epoch", epoch, input.now) };
}
