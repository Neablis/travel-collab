import { AdminGrantInput } from "@tc/contracts";
import { issueGrant, revokeGrant } from "@/server/entitlements/grants";
import { livePlanVersion, planVersionFromRef } from "@/server/entitlements/planVersions";
import { requireAdminApi } from "@/server/entitlements/requireAdmin";

// **Granting is the only write on the operator surface** (M20 link 7, and the
// 2026-09-02 amendment is explicit that it stays). Publishing and migrating
// plan versions are deliberately not here — versions are a committed file and
// the tier panel is read-only over them. Grants are ACCOUNT STATE, not plan
// definition, and they are the entire reason this milestone is provable
// without Stripe.

export async function POST(request: Request) {
  const guard = await requireAdminApi();
  if ("error" in guard) return guard.error;

  const body = AdminGrantInput.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return Response.json({ error: "invalid-grant", issues: body.error.issues }, { status: 400 });
  }
  const { planId, expiresAt, reason } = body.data;

  // **The grant pins a version**, and it pins the one that is live at the
  // moment it is issued — a grant is an offer someone was given, so it pins
  // exactly as a purchase does (ADR-045 rule 3). Resolved here rather than
  // taken from the request: an operator typing a version number is an operator
  // who can type one that does not exist, and the failure would be a silent
  // entitlement hole rather than a 400.
  const pinned = livePlanVersion(planId);
  // A disabled plan may not be handed out. `enabled` bounds what an operator
  // may grant, never what a holder may do — which is what lets the fourth-plan
  // proof ship without anyone being able to receive it.
  if (!pinned.enabled) {
    return Response.json({ error: "plan-not-available" }, { status: 400 });
  }
  // Belt and braces: the ref this writes must resolve on read, or the grant is
  // an entitlement hole the resolver will throw on.
  planVersionFromRef(`${pinned.planId}@v${pinned.version}`);

  const written = await issueGrant({
    userId: body.data.userId,
    planId: pinned.planId,
    planVersion: pinned.version,
    source: "admin",
    grantedBy: guard.userId,
    reason,
    expiresAt: expiresAt === null ? null : new Date(expiresAt),
  });
  return Response.json({ granted: written }, { status: written ? 201 : 200 });
}

export async function DELETE(request: Request) {
  const guard = await requireAdminApi();
  if ("error" in guard) return guard.error;

  const body = await request.json().catch(() => null);
  const grantId = typeof body === "object" && body !== null ? (body as { grantId?: unknown }).grantId : null;
  if (typeof grantId !== "string" || grantId === "") {
    return Response.json({ error: "invalid-grant-id" }, { status: 400 });
  }
  // **Marks, never deletes.** Revoking is not tidying: the row is what answers
  // "has this account ever held a trial", and removing it would hand the trial
  // back to whoever had it revoked.
  const revoked = await revokeGrant(grantId, guard.userId);
  return revoked
    ? Response.json({ revoked: true })
    : Response.json({ error: "not-found" }, { status: 404 });
}
