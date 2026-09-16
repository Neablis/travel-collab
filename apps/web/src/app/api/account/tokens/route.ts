import { ApiTokenCreateInput } from "@tc/contracts";
import { auth } from "@/server/auth";
import { listTokens, mintToken } from "@/server/api-tokens";

// **Managing tokens is a SESSION-ONLY surface, and that is a security decision
// rather than an oversight** (M22 Phase 3).
//
// This route lives under `/api/*` and not under `v1/`, so it is unreachable
// with a bearer token. A token that could mint tokens is a token that can grant
// itself scopes its owner never approved and outlive its own revocation — the
// classic privilege-escalation shape, and the reason every comparable product
// makes credential management a password-and-session act.
//
// So: the API can read and change your trips. Only YOU, signed in, can decide
// what may hold that power. No scope names this route and none ever should.
//
// **Its own identity, never a query parameter** — the `account/plan` rule. An
// account may manage its own tokens and nobody else's, and the only way to
// guarantee that is for the caller not to name a subject.

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (userId === undefined) return Response.json({ error: "unauthenticated" }, { status: 401 });
  // **Deliberately not gated on the entitlement.** An account that lapses must
  // still be able to SEE and REVOKE the tokens it already has — refusing the
  // list would leave live credentials the owner can no longer reach, which is
  // the opposite of what a lapse should do. Minting is what the entitlement
  // gates; using one is what the API gates.
  return Response.json({ tokens: await listTokens(userId) });
}

export async function POST(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (userId === undefined) return Response.json({ error: "unauthenticated" }, { status: 401 });

  const body = ApiTokenCreateInput.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return Response.json({ error: "invalid-token-request", issues: body.error.issues }, { status: 400 });
  }

  const minted = await mintToken(userId, body.data);
  if (!minted.ok) {
    // 402 for the entitlement, matching `AI_NOT_ENTITLED_STATUS` rather than
    // inventing a second shape for the same idea; 400 for a lifetime past the
    // ceiling, which the schema above already refuses and this refuses again
    // because a ceiling that lives only in a request schema is one an internal
    // caller walks straight past.
    return minted.reason === "not-entitled"
      ? Response.json({ error: "api-not-entitled" }, { status: 402 })
      : Response.json({ error: "invalid-token-lifetime", maxDays: minted.maxDays }, { status: 400 });
  }

  // **The one and only response that carries the secret.** Nothing stores it,
  // so nothing can return it again — which is why `ApiToken` has no field for
  // it and why the UI has to show it once, immediately.
  return Response.json(minted.created, { status: 201 });
}
