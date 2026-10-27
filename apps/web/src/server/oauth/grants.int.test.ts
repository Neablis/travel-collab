// **Grants**, against a real database: consent stops a client expiring, a code
// is stored as a keyed digest with its key version, and an owner revokes only
// their own grant, which takes every token with it on the next read.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { oauthClients, oauthCodes } from "@/server/db/schema";
import { keyedDigest } from "@/server/secrets/keyedDigest";
import { registerClient, resolveClient, type OAuthClient } from "./clients";
import { createGrant, grantIsLive, grantOf, issueCode, listGrants, revokeGrant, touchGrantLastUsed } from "./grants";
import { mcpResource } from "./metadata";
import { exchangeCode } from "./tokens";

const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const REDIRECT = "https://example.com/cb";

async function client(): Promise<OAuthClient> {
  const registered = await registerClient({ redirect_uris: [REDIRECT] }, randomUUID());
  const resolved = await resolveClient(registered.ok ? String(registered.body.client_id) : "");
  if (!resolved.ok) throw new Error("no client");
  return resolved.client;
}

const grantFor = (ownerId: string, app: OAuthClient, now = new Date()) =>
  createGrant({ ownerId, client: app, redirectUri: REDIRECT, scopes: ["trips:read"], resource: mcpResource(), now });

describe("consent", () => {
  it("marks the client used, so it no longer expires unused", async () => {
    const grant = await grantFor(`dev-${randomUUID()}`, await client());
    const [row] = await db.select().from(oauthClients).where(eq(oauthClients.id, grant.clientId));
    expect(row!.firstUsedAt).not.toBeNull();
  });

  it("stores a code as its keyed digest and key version, with a one-minute life", async () => {
    const app = await client();
    const now = new Date();
    const grant = await grantFor(`dev-${randomUUID()}`, app, now);
    const code = await issueCode({ grantId: grant.id, codeChallenge: CHALLENGE, redirectUri: REDIRECT, resource: mcpResource(), now });
    const { digest, keyVersion } = keyedDigest(code);
    const [row] = await db.select().from(oauthCodes).where(eq(oauthCodes.codeHash, digest));
    expect(row).toEqual(expect.objectContaining({ keyVersion, grantId: grant.id }));
    expect(row!.expiresAt.getTime() - now.getTime()).toBe(60_000);
  });
});

describe("revokeGrant", () => {
  it("revokes the owner's own grant, idempotently, and its codes stop working", async () => {
    const owner = `dev-${randomUUID()}`;
    const app = await client();
    const now = new Date();
    const grant = await grantFor(owner, app, now);
    const code = await issueCode({ grantId: grant.id, codeChallenge: CHALLENGE, redirectUri: REDIRECT, resource: mcpResource(), now });
    expect(await revokeGrant(owner, grant.id, "owner")).toBe(true);
    expect(await revokeGrant(owner, grant.id, "owner")).toBe(true);
    expect(grantIsLive((await grantOf(grant.id))!, new Date())).toBe(false);
    const outcome = await exchangeCode({ code, codeVerifier: VERIFIER, redirectUri: REDIRECT, clientId: app.clientId });
    expect(outcome).toEqual(expect.objectContaining({ ok: false, error: "invalid_grant" }));
  });

  it("refuses to revoke someone else's grant, and answers false for an id that is not one", async () => {
    const grant = await grantFor(`dev-${randomUUID()}`, await client());
    expect(await revokeGrant(`dev-${randomUUID()}`, grant.id, "owner")).toBe(false);
    expect(await revokeGrant("anyone", "not-a-uuid", "owner")).toBe(false);
    expect((await grantOf(grant.id))!.revokedAt).toBeNull();
  });
});

describe("listGrants", () => {
  it("lists one owner's grants, newest first, revoked ones included", async () => {
    const owner = `dev-${randomUUID()}`;
    const app = await client();
    const older = await grantFor(owner, app, new Date("2026-10-01T00:00:00.000Z"));
    const newer = await grantFor(owner, app, new Date("2026-10-02T00:00:00.000Z"));
    await grantFor(`dev-${randomUUID()}`, app);
    await revokeGrant(owner, older.id, "owner");
    expect((await listGrants(owner)).map((grant) => grant.id)).toEqual([newer.id, older.id]);
  });
});

describe("touchGrantLastUsed", () => {
  it("records a use, then writes again only once five minutes have passed", async () => {
    const grant = await grantFor(`dev-${randomUUID()}`, await client());
    const first = new Date("2026-10-27T10:00:00.000Z");
    await touchGrantLastUsed(grant.id, first);
    expect((await grantOf(grant.id))!.lastUsedAt).toEqual(first);
    await touchGrantLastUsed(grant.id, new Date(first.getTime() + 4 * 60 * 1000));
    expect((await grantOf(grant.id))!.lastUsedAt).toEqual(first);
    const later = new Date(first.getTime() + 5 * 60 * 1000 + 1);
    await touchGrantLastUsed(grant.id, later);
    expect((await grantOf(grant.id))!.lastUsedAt).toEqual(later);
  });
});
