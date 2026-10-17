import { auth } from "@/server/auth";
import { codesMintedBy, mintReferralCode, paidPlanHeldBy } from "@/server/entitlements/referrals";

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

  // **Whether a redemption would earn anything**: the same read the reward
  // itself makes, so the sheet cannot promise what `rewardReferrer` refuses.
  const earns = (await paidPlanHeldBy(userId)) !== null;

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
