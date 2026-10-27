import { randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { ApiScope, OAUTH_CODE_PREFIX } from "@tc/contracts";
import { db } from "@/server/db/client";
import { oauthCodes, oauthGrants } from "@/server/db/schema";
import { keyedDigest } from "@/server/secrets/keyedDigest";
import { markClientUsed, storeClient, type OAuthClient } from "./clients";

// **A grant is one person's consent to one client** (ADR-083 §1): the scopes,
// the redirect and the resource they agreed to, for at most a year. Codes and
// tokens hang off it, and every one of them is only as alive as its grant, read
// on use. Revoking the grant is therefore the one write that cuts off its
// codes, refresh tokens and access tokens together.

export type GrantRow = typeof oauthGrants.$inferSelect;
export type GrantRevokedReason = NonNullable<GrantRow["revokedReason"]>;

const DAY_MS = 24 * 60 * 60 * 1000;
/** ADR-083 §4: no refresh outlives the grant, and the grant lives a year. */
export const GRANT_LIFETIME_MS = 365 * DAY_MS;
/** ADR-083 §4: a code lives one minute. */
export const CODE_LIFETIME_MS = 60 * 1000;

/** A fresh secret: the prefix, then 32 random bytes. */
export function mintSecret(prefix: string): string {
  return `${prefix}${randomBytes(32).toString("base64url")}`;
}

/**
 * Record consent, writing a CIMD client's row now that someone allowed it. The
 * client's first grant also stops it expiring unused.
 */
export async function createGrant(input: {
  ownerId: string;
  client: OAuthClient;
  redirectUri: string;
  scopes: readonly ApiScope[];
  resource: string;
  now: Date;
}): Promise<GrantRow> {
  const clientRowId = await storeClient(input.client, input.now);
  const [row] = await db
    .insert(oauthGrants)
    .values({
      id: randomUUID(),
      ownerId: input.ownerId,
      clientId: clientRowId,
      clientName: input.client.clientName,
      redirectUri: input.redirectUri,
      scopes: [...input.scopes],
      resource: input.resource,
      createdAt: input.now,
      lastUsedAt: null,
      expiresAt: new Date(input.now.getTime() + GRANT_LIFETIME_MS),
      revokedAt: null,
      revokedReason: null,
    })
    .returning();
  await markClientUsed(clientRowId, input.now);
  return row!;
}

/** Issue the one-minute code the client exchanges, bound to the challenge, redirect and resource it asked with. */
export async function issueCode(input: {
  grantId: string;
  codeChallenge: string;
  redirectUri: string;
  resource: string;
  now: Date;
}): Promise<string> {
  const secret = mintSecret(OAUTH_CODE_PREFIX);
  const { digest, keyVersion } = keyedDigest(secret);
  await db.insert(oauthCodes).values({
    id: randomUUID(),
    codeHash: digest,
    keyVersion,
    grantId: input.grantId,
    codeChallenge: input.codeChallenge,
    redirectUri: input.redirectUri,
    resource: input.resource,
    createdAt: input.now,
    expiresAt: new Date(input.now.getTime() + CODE_LIFETIME_MS),
    usedAt: null,
  });
  return secret;
}

/** The grant `grantId` names, live or not, or `null` when there is none. */
export async function grantOf(grantId: string): Promise<GrantRow | null> {
  const [row] = await db.select().from(oauthGrants).where(eq(oauthGrants.id, grantId));
  return row ?? null;
}

/** Live: not revoked, and inside its year. */
export function grantIsLive(grant: GrantRow, now: Date): boolean {
  return grant.revokedAt === null && grant.expiresAt.getTime() > now.getTime();
}

/** The scopes a grant holds, parsed: a `text[]` is not a guarantee. */
export function grantScopes(grant: GrantRow): ApiScope[] {
  return grant.scopes.filter((scope): scope is ApiScope => ApiScope.safeParse(scope).success);
}

/**
 * Cut a grant off: its codes, refresh tokens and access tokens all stop on
 * their next read. Idempotent; the first reason stands.
 */
export async function cutOffGrant(grantId: string, reason: GrantRevokedReason, now: Date): Promise<void> {
  await db
    .update(oauthGrants)
    .set({ revokedAt: now, revokedReason: reason })
    .where(and(eq(oauthGrants.id, grantId), isNull(oauthGrants.revokedAt)));
}

/**
 * The owner disconnects an app. Only their own grant: `false` when this owner
 * has no such grant, whatever someone else's might be. Idempotent.
 */
export async function revokeGrant(
  ownerId: string,
  grantId: string,
  reason: GrantRevokedReason,
  now: Date = new Date(),
): Promise<boolean> {
  // A path parameter that is not a uuid names no grant, and Postgres would throw on it.
  if (!z.uuid().safeParse(grantId).success) return false;
  const [row] = await db
    .select({ id: oauthGrants.id })
    .from(oauthGrants)
    .where(and(eq(oauthGrants.id, grantId), eq(oauthGrants.ownerId, ownerId)));
  if (row === undefined) return false;
  await cutOffGrant(grantId, reason, now);
  return true;
}

/** Every grant this person has made, newest first, dead ones included so a list can say why. */
export async function listGrants(ownerId: string): Promise<GrantRow[]> {
  return db
    .select()
    .from(oauthGrants)
    .where(eq(oauthGrants.ownerId, ownerId))
    .orderBy(desc(oauthGrants.createdAt), desc(oauthGrants.id));
}
