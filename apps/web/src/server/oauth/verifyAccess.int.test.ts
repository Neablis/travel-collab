// **An access token is verified against its own row and its grant, every
// call** (ADR-083 §7), against a real database: each refusal by name, and the
// one this file exists for, an access token revoked by RFC 7009 while its grant
// stays live.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { ApiScope } from "@tc/contracts";
import { db } from "@/server/db/client";
import { oauthGrants } from "@/server/db/schema";
import { issueGrant } from "@/server/entitlements/grants";
import { livePlanVersion } from "@/server/entitlements/planVersions";
import { upsertUser } from "@/server/users";
import { registerClient, resolveClient } from "./clients";
import { createGrant, grantIsLive, grantOf, issueCode, revokeGrant } from "./grants";
import { mcpResource } from "./metadata";
import { exchangeCode, revokeSecret } from "./tokens";
import { verifyAccessToken } from "./verifyAccess";

const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const REDIRECT = "https://example.com/cb";

async function person(premium: boolean): Promise<string> {
  const id = `oauth-va-${randomUUID().slice(0, 8)}`;
  await upsertUser({ id, email: `${id}@example.test`, name: null, image: null });
  if (premium) {
    const plan = livePlanVersion("premium");
    await issueGrant({
      userId: id,
      planId: plan.planId,
      planVersion: plan.version,
      source: "admin",
      grantedBy: "dev-operator",
      reason: "M55 OAuth actor fixture.",
      expiresAt: null,
    });
  }
  return id;
}

/** Consent, a code and its exchange: the tokens a connected client holds. */
async function connect(ownerId: string, scopes: ApiScope[] = ["trips:read"], now = new Date()) {
  const registered = await registerClient({ client_name: "Test app", redirect_uris: [REDIRECT] }, randomUUID());
  const resolved = await resolveClient(registered.ok ? String(registered.body.client_id) : "");
  if (!resolved.ok) throw new Error("no client");
  const grant = await createGrant({ ownerId, client: resolved.client, redirectUri: REDIRECT, scopes, resource: mcpResource(), now });
  const code = await issueCode({ grantId: grant.id, codeChallenge: CHALLENGE, redirectUri: REDIRECT, resource: mcpResource(), now });
  const tokens = await exchangeCode({ code, codeVerifier: VERIFIER, redirectUri: REDIRECT, clientId: resolved.client.clientId }, now);
  if (!tokens.ok) throw new Error(tokens.description);
  return { grant, access: tokens.body.access_token, refresh: tokens.body.refresh_token };
}

describe("verifyAccessToken", () => {
  it("answers the grant, its owner, its client's name and its scopes for a live token", async () => {
    const owner = await person(true);
    const { grant, access } = await connect(owner, ["trips:read", "account:read"]);
    const verified = await verifyAccessToken(access);
    expect(verified).toEqual({
      ok: true,
      access: { grantId: grant.id, ownerId: owner, clientName: "Test app", scopes: new Set(["trips:read", "account:read"]) },
    });
  });

  it("refuses as unknown a secret it never issued, a refresh token, and a tc_ token", async () => {
    const { refresh } = await connect(await person(true));
    expect(await verifyAccessToken("tco_neverIssued")).toEqual({ ok: false, refusal: { reason: "unknown" } });
    expect(await verifyAccessToken(refresh)).toEqual({ ok: false, refusal: { reason: "unknown" } });
    expect(await verifyAccessToken("tc_something")).toEqual({ ok: false, refusal: { reason: "unknown" } });
  });

  it("refuses an access token past its hour as expired", async () => {
    const issued = new Date();
    const { access } = await connect(await person(true), ["trips:read"], issued);
    const later = new Date(issued.getTime() + 60 * 60 * 1000 + 1);
    expect(await verifyAccessToken(access, later)).toEqual(
      expect.objectContaining({ ok: false, refusal: expect.objectContaining({ reason: "expired" }) }),
    );
  });

  it("refuses every token of a grant its owner revoked", async () => {
    const owner = await person(true);
    const { grant, access } = await connect(owner);
    await revokeGrant(owner, grant.id, "owner");
    expect(await verifyAccessToken(access)).toEqual(
      expect.objectContaining({ ok: false, refusal: expect.objectContaining({ reason: "revoked" }) }),
    );
  });

  // RFC 7009 revocation of an access token marks that token alone: the grant
  // stays live, so a check of the grant only would still accept it.
  it("refuses an access token revoked on its own, while its grant stays live", async () => {
    const { grant, access } = await connect(await person(true));
    await revokeSecret(access);
    expect(grantIsLive((await grantOf(grant.id))!, new Date())).toBe(true);
    expect(await verifyAccessToken(access)).toEqual(
      expect.objectContaining({ ok: false, refusal: expect.objectContaining({ reason: "revoked" }) }),
    );
  });

  it("refuses a token whose owner's plan does not include API access", async () => {
    const owner = await person(false);
    const { access } = await connect(owner);
    expect(await verifyAccessToken(access)).toEqual({ ok: false, refusal: { reason: "not-entitled", ownerId: owner } });
  });

  it("refuses a token whose grant names another resource (amendment C)", async () => {
    const { grant, access } = await connect(await person(true));
    await db.update(oauthGrants).set({ resource: "https://elsewhere.example/api/mcp" }).where(eq(oauthGrants.id, grant.id));
    expect(await verifyAccessToken(access)).toEqual({ ok: false, refusal: { reason: "audience" } });
  });
});
