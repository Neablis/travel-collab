// **The token endpoint's grants**, against a real database, because the two
// races below only exist there: a parallel code redemption and a parallel
// refresh rotation, each of which must have exactly one winner (ADR-083
// amendment D). Each RFC error code is here once, and so is each named attack
// from the 2026-10-27 review: the PKCE downgrade and a lost rotation response.
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { oauthCodes, oauthTokens } from "@/server/db/schema";
import { keyedDigest } from "@/server/secrets/keyedDigest";
import { registerClient, resolveClient, type OAuthClient } from "./clients";
import { createGrant, grantOf, issueCode, mintSecret } from "./grants";
import { mcpResource } from "./metadata";
import { exchangeCode, refresh, revokeSecret, type TokenOutcome } from "./tokens";

// RFC 7636 appendix B.
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const REDIRECT = "https://example.com/cb";

async function client(): Promise<OAuthClient> {
  const registered = await registerClient({ client_name: "Test", redirect_uris: [REDIRECT] }, randomUUID());
  if (!registered.ok) throw new Error("registration failed");
  const resolved = await resolveClient(String(registered.body.client_id));
  if (!resolved.ok) throw new Error("resolve failed");
  return resolved.client;
}

/** A consented grant and one fresh code for it, as the consent decision leaves them. */
async function consented(over: { codeChallenge?: string; resource?: string } = {}) {
  const app = await client();
  const now = new Date();
  const grant = await createGrant({
    ownerId: `dev-${randomUUID()}`,
    client: app,
    redirectUri: REDIRECT,
    scopes: ["trips:read", "library:write"],
    resource: over.resource ?? mcpResource(),
    now,
  });
  const code = await issueCode({
    grantId: grant.id,
    codeChallenge: over.codeChallenge ?? CHALLENGE,
    redirectUri: REDIRECT,
    resource: over.resource ?? mcpResource(),
    now,
  });
  const exchange = (input: Partial<Parameters<typeof exchangeCode>[0]> = {}) =>
    exchangeCode({ code, codeVerifier: VERIFIER, redirectUri: REDIRECT, clientId: app.clientId, ...input });
  return { app, grant, code, exchange };
}

/**
 * Open enough pool connections that two requests really overlap. On a cold
 * pool the second request waits for a fresh connection while the first runs to
 * the end, the race never happens, and a broken guard passes (seen: the split
 * SELECT-then-UPDATE stayed green without this).
 */
async function warmPool(): Promise<void> {
  await Promise.all(Array.from({ length: 4 }, () => db.execute(sql`select pg_sleep(0.01)`)));
}

const errorOf = (outcome: TokenOutcome) => (outcome.ok ? "ok" : outcome.error);
const tokensOf = (outcome: TokenOutcome) => {
  if (!outcome.ok) throw new Error(`expected tokens, got ${outcome.error}: ${outcome.description}`);
  return outcome.body;
};

describe("exchanging a code", () => {
  it("answers an access token, a refresh token and the grant's scopes, and stores neither secret", async () => {
    const { exchange, grant } = await consented();
    const body = tokensOf(await exchange());
    expect(body).toEqual(
      expect.objectContaining({ token_type: "Bearer", expires_in: 3600, scope: "trips:read library:write" }),
    );
    expect(body.access_token.startsWith("tco_")).toBe(true);
    expect(body.refresh_token.startsWith("tcr_")).toBe(true);
    const rows = await db.select().from(oauthTokens).where(eq(oauthTokens.grantId, grant.id));
    expect(rows.map((row) => row.tokenHash).sort()).toEqual(
      [keyedDigest(body.access_token).digest, keyedDigest(body.refresh_token).digest].sort(),
    );
    expect(rows.every((row) => row.keyVersion === keyedDigest(body.access_token).keyVersion)).toBe(true);
  });

  it("answers invalid_request without a code, a redirect_uri or a client_id", async () => {
    const { exchange } = await consented();
    expect(errorOf(await exchange({ code: undefined }))).toBe("invalid_request");
    expect(errorOf(await exchange({ redirectUri: undefined }))).toBe("invalid_request");
    expect(errorOf(await exchange({ clientId: undefined }))).toBe("invalid_request");
  });

  it("answers invalid_grant for a wrong redirect, another client, or an unknown code", async () => {
    const { exchange } = await consented();
    const other = await client();
    expect(errorOf(await exchange({ redirectUri: `${REDIRECT}/` }))).toBe("invalid_grant");
    expect(errorOf(await exchange({ clientId: other.clientId }))).toBe("invalid_grant");
    expect(errorOf(await exchange({ code: mintSecret("tcc_") }))).toBe("invalid_grant");
    // None of those spent it.
    expect(errorOf(await exchange())).toBe("ok");
  });

  it("answers invalid_target for a resource that is not this server's, at exchange and on the grant", async () => {
    const { exchange } = await consented();
    expect(errorOf(await exchange({ resource: "https://other.example/api/mcp" }))).toBe("invalid_target");
    const stale = await consented({ resource: "https://old-origin.example/api/mcp" });
    expect(errorOf(await stale.exchange())).toBe("invalid_target");
  });

  it("revokes the grant when a code is presented a second time", async () => {
    const { exchange, grant } = await consented();
    expect(errorOf(await exchange())).toBe("ok");
    expect(errorOf(await exchange())).toBe("invalid_grant");
    expect(await grantOf(grant.id)).toEqual(expect.objectContaining({ revokedReason: "code-reuse" }));
  });
});

describe("parallel code redemption", () => {
  it("lets exactly one of two simultaneous exchanges win, and revokes the grant", async () => {
    const { exchange, grant } = await consented();
    await warmPool();
    const outcomes = await Promise.all([exchange(), exchange()]);
    expect(outcomes.map(errorOf).sort()).toEqual(["invalid_grant", "ok"]);
    expect(await grantOf(grant.id)).toEqual(expect.objectContaining({ revokedReason: "code-reuse" }));
  });
});

describe("the PKCE downgrade at the token endpoint", () => {
  it("refuses a normal code with no code_verifier, or the wrong one", async () => {
    const { exchange } = await consented();
    expect(errorOf(await exchange({ codeVerifier: undefined }))).toBe("invalid_grant");
    expect(errorOf(await exchange({ codeVerifier: `${VERIFIER.slice(0, -1)}A` }))).toBe("invalid_grant");
  });

  // The column is NOT NULL (amendment I), so an empty challenge is the nearest
  // a row can come to none: what a bug, or a hand-written row, would leave.
  it("never redeems a code row written with no challenge, with or without a verifier", async () => {
    const { exchange, code } = await consented();
    await db.update(oauthCodes).set({ codeChallenge: "" }).where(eq(oauthCodes.codeHash, keyedDigest(code).digest));
    expect(errorOf(await exchange({ codeVerifier: undefined }))).toBe("invalid_grant");
    expect(errorOf(await exchange())).toBe("invalid_grant");
  });
});

describe("refreshing", () => {
  it("rotates: a new pair, and the old refresh token is spent", async () => {
    const { exchange, app } = await consented();
    const first = tokensOf(await exchange());
    const second = tokensOf(await refresh({ refreshToken: first.refresh_token, clientId: app.clientId }));
    expect(second.refresh_token).not.toBe(first.refresh_token);
    expect(errorOf(await refresh({ refreshToken: second.refresh_token, clientId: app.clientId }))).toBe("ok");
  });

  it("answers invalid_request without a token or a client_id", async () => {
    const { app } = await consented();
    expect(errorOf(await refresh({ clientId: app.clientId }))).toBe("invalid_request");
    expect(errorOf(await refresh({ refreshToken: "tcr_x" }))).toBe("invalid_request");
  });

  it("answers invalid_grant for an access token presented as a refresh token, or another client", async () => {
    const { exchange, app } = await consented();
    const body = tokensOf(await exchange());
    const other = await client();
    expect(errorOf(await refresh({ refreshToken: body.access_token, clientId: app.clientId }))).toBe("invalid_grant");
    expect(errorOf(await refresh({ refreshToken: body.refresh_token, clientId: other.clientId }))).toBe("invalid_grant");
  });

  // Amendment K: the documented cost of rotation with no grace window.
  it("revokes the grant when a lost rotation response makes the client present the old refresh token", async () => {
    const { exchange, app, grant } = await consented();
    const first = tokensOf(await exchange());
    tokensOf(await refresh({ refreshToken: first.refresh_token, clientId: app.clientId }));
    expect(errorOf(await refresh({ refreshToken: first.refresh_token, clientId: app.clientId }))).toBe("invalid_grant");
    expect(await grantOf(grant.id)).toEqual(expect.objectContaining({ revokedReason: "refresh-reuse" }));
  });
});

describe("parallel refresh rotation", () => {
  it("lets exactly one of two simultaneous refreshes win, and revokes the grant", async () => {
    const { exchange, app, grant } = await consented();
    const { refresh_token } = tokensOf(await exchange());
    await warmPool();
    const outcomes = await Promise.all([
      refresh({ refreshToken: refresh_token, clientId: app.clientId }),
      refresh({ refreshToken: refresh_token, clientId: app.clientId }),
    ]);
    expect(outcomes.map(errorOf).sort()).toEqual(["invalid_grant", "ok"]);
    expect(await grantOf(grant.id)).toEqual(expect.objectContaining({ revokedReason: "refresh-reuse" }));
  });
});

describe("revoking", () => {
  it("takes the grant with a refresh token, so nothing refreshes after", async () => {
    const { exchange, app, grant } = await consented();
    const body = tokensOf(await exchange());
    await revokeSecret(body.refresh_token);
    expect(await grantOf(grant.id)).toEqual(expect.objectContaining({ revokedReason: "owner" }));
    expect(errorOf(await refresh({ refreshToken: body.refresh_token, clientId: app.clientId }))).toBe("invalid_grant");
  });

  it("takes only itself with an access token, and ignores a secret it does not know", async () => {
    const { exchange, grant } = await consented();
    const body = tokensOf(await exchange());
    await revokeSecret(body.access_token);
    await revokeSecret("tco_not-a-real-token");
    const [access] = await db
      .select()
      .from(oauthTokens)
      .where(eq(oauthTokens.tokenHash, keyedDigest(body.access_token).digest));
    expect(access!.revokedAt).not.toBeNull();
    expect((await grantOf(grant.id))!.revokedAt).toBeNull();
  });
});
