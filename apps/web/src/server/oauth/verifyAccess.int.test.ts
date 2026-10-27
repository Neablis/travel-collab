// **An access token is verified against its own row and its grant, every
// call** (ADR-083 §7), against a real database: each refusal by name, and the
// one this file exists for, an access token revoked by RFC 7009 while its grant
// stays live.
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { oauthGrants, oauthTokens } from "@/server/db/schema";
import { issueGrant } from "@/server/entitlements/grants";
import { livePlanVersion } from "@/server/entitlements/planVersions";
import { connectForTest as connect } from "@/server/test-support/oauthConnection";
import { upsertUser } from "@/server/users";
import { grantIsLive, grantOf, revokeGrant } from "./grants";
import { revokeSecret } from "./tokens";
import { verifyAccessToken } from "./verifyAccess";

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

  // A refresh token's `tcr_` prefix refuses it before any read, so this is the
  // case the `kind = 'access'` filter alone answers: a refresh row whose secret
  // is `tco_`-shaped.
  it("refuses as unknown a tco_ secret whose row is a refresh token", async () => {
    const { grant, access } = await connect(await person(true));
    await db
      .update(oauthTokens)
      .set({ kind: "refresh" })
      .where(and(eq(oauthTokens.grantId, grant.id), eq(oauthTokens.kind, "access")));
    expect(await verifyAccessToken(access)).toEqual({ ok: false, refusal: { reason: "unknown" } });
  });

  it("refuses an access token past its hour as expired", async () => {
    const issued = new Date();
    const { access } = await connect(await person(true), ["trips:read"], issued);
    const later = new Date(issued.getTime() + 60 * 60 * 1000 + 1);
    expect(await verifyAccessToken(access, later)).toEqual(
      expect.objectContaining({ ok: false, refusal: expect.objectContaining({ reason: "expired" }) }),
    );
  });

  // `issueTokens` caps a refresh token at its grant's expiry but not an access
  // token, so in a grant's last hour this is the only check that refuses one.
  it("refuses an access token still within its hour once its grant has expired", async () => {
    const { grant, access } = await connect(await person(true));
    const grantExpired = new Date(Date.now() - 1000);
    await db.update(oauthGrants).set({ expiresAt: grantExpired }).where(eq(oauthGrants.id, grant.id));
    expect(await verifyAccessToken(access)).toEqual({ ok: false, refusal: { reason: "expired", expiresAt: grantExpired } });
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
    expect(await verifyAccessToken(access)).toEqual({ ok: false, refusal: { reason: "resource" } });
  });
});
