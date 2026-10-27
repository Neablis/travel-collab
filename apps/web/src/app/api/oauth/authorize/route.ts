import { z } from "zod";
import { ApiScope } from "@tc/contracts";
import { auth } from "@/server/auth";
import { accountCan } from "@/server/entitlements/resolver";
import { parseAuthorizeRequest, redirectBack } from "@/server/oauth/authorizeRequest";
import { createGrant, issueCode } from "@/server/oauth/grants";
import { oauthIssuer } from "@/server/oauth/metadata";

// **The consent decision: `POST /api/oauth/authorize`** (ADR-083 §6, *CSRF on
// the consent decision*).
//
// The consent page posts here with `fetch` and then sends the browser to the
// `redirectTo` it gets back. A native form POST that 302s to the client is what
// the CSP's `form-action 'self'` blocks, and that directive stays.
//
// **Nothing from the page is trusted but the choice.** The authorize request is
// parsed again from its parameters, so a page left open while the client's
// registration changed, or a forged body, is checked as if it had just arrived.
// Session only, same origin only: a credential must never be able to consent.

const Decision = z.object({
  params: z.record(z.string(), z.string()),
  decision: z.enum(["allow", "deny"]),
  scopes: z.array(ApiScope).default([]),
});

/** Record Allow or Deny for a signed-in person on this origin, answering where the browser goes next. */
export async function POST(request: Request) {
  const userId = (await auth())?.user?.id;
  if (userId === undefined) return Response.json({ error: "unauthenticated" }, { status: 401 });
  // The session cookie is SameSite=Lax, and this is the second lock: a page on
  // another origin cannot post a consent, whatever it gets the browser to send.
  if (request.headers.get("origin") !== oauthIssuer()) {
    return Response.json({ error: "cross-origin" }, { status: 403 });
  }
  const body = Decision.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "invalid-decision" }, { status: 400 });

  const parsed = await parseAuthorizeRequest(body.data.params, { userId });
  if ("show" in parsed) return Response.json({ error: parsed.show.error, description: parsed.show.description }, { status: 400 });
  // Followed whatever the client: the person has just clicked on our page,
  // which is the click amendment M asks for.
  if ("redirectTo" in parsed) return Response.json({ redirectTo: parsed.redirectTo });
  const { request: authorize } = parsed;

  if (body.data.decision === "deny") {
    return Response.json({ redirectTo: redirectBack(authorize.redirectUri, authorize.state, { error: "access_denied" }) });
  }
  // D6: the same entitlement minting a token needs. Checked again on every use (part 3).
  if (!(await accountCan(userId, "api.tokens"))) return Response.json({ error: "api-not-entitled" }, { status: 402 });
  const scopes = body.data.scopes;
  if (scopes.length === 0 || scopes.some((scope) => !authorize.scopes.includes(scope))) {
    return Response.json({ error: "invalid-scopes" }, { status: 400 });
  }
  const now = new Date();
  const grant = await createGrant({
    ownerId: userId,
    client: authorize.client,
    redirectUri: authorize.redirectUri,
    scopes,
    resource: authorize.resource,
    now,
  });
  const code = await issueCode({
    grantId: grant.id,
    codeChallenge: authorize.codeChallenge,
    redirectUri: authorize.redirectUri,
    resource: authorize.resource,
    now,
  });
  return Response.json({ redirectTo: redirectBack(authorize.redirectUri, authorize.state, { code }) });
}
