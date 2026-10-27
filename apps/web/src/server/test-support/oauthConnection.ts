// **A connected OAuth client, for tests** (ADR-083): registration, consent, a
// code and its exchange, through part 2's own functions, so a suite holds the
// tokens a real client would. One copy, so a change to `issueCode` or
// `exchangeCode` is made here and not in every suite that needs a token.
//
// Under `src/server/`, as `entitledAccount.ts` is: it writes the database.
import { randomUUID } from "node:crypto";
import type { ApiScope } from "@tc/contracts";
import { registerClient, resolveClient } from "@/server/oauth/clients";
import { createGrant, issueCode } from "@/server/oauth/grants";
import { mcpResource } from "@/server/oauth/metadata";
import { exchangeCode } from "@/server/oauth/tokens";

// RFC 7636 appendix B's pair.
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const REDIRECT = "https://example.com/cb";

/** A client named "Test app" granted `scopes` by `ownerId` at `now`, and the tokens it holds. */
export async function connectForTest(ownerId: string, scopes: ApiScope[] = ["trips:read"], now = new Date()) {
  const registered = await registerClient({ client_name: "Test app", redirect_uris: [REDIRECT] }, randomUUID());
  const resolved = await resolveClient(registered.ok ? String(registered.body.client_id) : "");
  if (!resolved.ok) throw new Error("no client");
  const clientId = resolved.client.clientId;
  const grant = await createGrant({ ownerId, client: resolved.client, redirectUri: REDIRECT, scopes, resource: mcpResource(), now });
  const code = await issueCode({ grantId: grant.id, codeChallenge: CHALLENGE, redirectUri: REDIRECT, resource: mcpResource(), now });
  const tokens = await exchangeCode({ code, codeVerifier: VERIFIER, redirectUri: REDIRECT, clientId }, now);
  if (!tokens.ok) throw new Error(tokens.description);
  return { grant, clientId, access: tokens.body.access_token, refresh: tokens.body.refresh_token };
}
