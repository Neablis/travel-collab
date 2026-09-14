import { auth } from "@/server/auth";
import { codesMintedBy, mintReferralCode } from "@/server/entitlements/referrals";
import { heldPlanFor } from "@/server/entitlements/grants";
import { planVersionFromRef } from "@/server/entitlements/planVersions";

// **Self-serve invite codes** (M20 link 8). Account scope, so the guard is
// `auth()` and a 401 — the same shape as `/api/account/preferences`, and for
// the same reason: this endpoint resolves no resource, and the only question is
// whether anyone is signed in.
//
// Before this, codes were minted by hand (`schema.ts`: *"invite-code
// administration is explicitly out of M11a's scope"*), so nobody could earn a
// referral they could not issue. This is the half that was missing.

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return Response.json({ error: "unauthenticated" }, { status: 401 });

  const held = await heldPlanFor(userId);
  // **Whether a redemption would earn anything**, asked as *"does the plan this
  // account HOLDS grant anything"* — never as a comparison against a plan id
  // (ADR-045 rule 4). A trial is a grant, not a held plan, so a trial-only
  // account reads `false` here, which is the narrowing that removes most of the
  // anti-abuse surface.
  const earns =
    held !== null && planVersionFromRef(`${held.planId}@v${held.planVersion}`).entitlements.length > 0;

  const codes = await codesMintedBy(userId);
  return Response.json({
    // Anyone may mint; minting is not the reward, redeeming is.
    codes: codes.map((row) => ({
      code: row.code,
      redeemed: row.redeemedBy !== null,
      createdAt: row.createdAt.toISOString(),
    })),
    earnsReward: earns,
  });
}

export async function POST() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return Response.json({ error: "unauthenticated" }, { status: 401 });

  const minted = await mintReferralCode(userId);
  if (!minted.ok) {
    return Response.json(
      { error: minted.reason, message: "You already have as many unused invite codes as you can hold." },
      { status: 409 },
    );
  }
  return Response.json({ code: minted.code }, { status: 201 });
}
