// **`POST /api/oauth/revoke`** (RFC 7009): 200 whatever is sent, and a real
// refresh token stops refreshing.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { registerClient, resolveClient } from "@/server/oauth/clients";
import { createGrant, grantOf, issueCode } from "@/server/oauth/grants";
import { mcpResource } from "@/server/oauth/metadata";
import { exchangeCode } from "@/server/oauth/tokens";
import { POST } from "./route";

const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const REDIRECT = "https://example.com/cb";

const revoke = (body: string) =>
  POST(
    new Request("http://localhost/api/oauth/revoke", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    }),
  );

describe("POST /api/oauth/revoke", () => {
  it("answers 200 for an unknown token, a malformed one and none at all", async () => {
    for (const body of ["token=tcr_not-real", "token=whatever", ""]) {
      expect((await revoke(body)).status).toBe(200);
    }
  });

  it("revokes a real refresh token's grant", async () => {
    const registered = await registerClient({ redirect_uris: [REDIRECT] }, randomUUID());
    const resolved = await resolveClient(registered.ok ? String(registered.body.client_id) : "");
    if (!resolved.ok) throw new Error("no client");
    const now = new Date();
    const grant = await createGrant({
      ownerId: `dev-${randomUUID()}`,
      client: resolved.client,
      redirectUri: REDIRECT,
      scopes: ["trips:read"],
      resource: mcpResource(),
      now,
    });
    const code = await issueCode({ grantId: grant.id, codeChallenge: CHALLENGE, redirectUri: REDIRECT, resource: mcpResource(), now });
    const outcome = await exchangeCode({ code, codeVerifier: VERIFIER, redirectUri: REDIRECT, clientId: resolved.client.clientId });
    if (!outcome.ok) throw new Error(outcome.description);
    expect((await revoke(`token=${outcome.body.refresh_token}&token_type_hint=refresh_token`)).status).toBe(200);
    expect((await grantOf(grant.id))!.revokedAt).not.toBeNull();
  });
});
