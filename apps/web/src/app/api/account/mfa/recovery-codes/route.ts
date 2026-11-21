import type { SessionWithMfa } from "@/lib/authConfig";
import { auth } from "@/server/auth";
import { hasFreshCheck, mfaStateFor, mintSecondFactorProof, bumpSecurityEpoch } from "@/server/mfa/state";
import { issueRecoveryCodes } from "@/server/mfa/recoveryCodes";

// *Regenerate* (M62 D7): ten new codes, shown once, and the old set voided, spent
// codes included. It bumps the epoch like every change to how an account is
// entered, which signs out the other sessions; this one is handed a proof so it is
// not signed out with them.
export async function POST() {
  const session = await auth();
  const userId = session?.user?.id;
  const sid = (session as SessionWithMfa | null)?.sid;
  if (userId === undefined || userId === "" || !sid) return Response.json({ error: "unauthenticated" }, { status: 401 });

  const now = new Date();
  const state = await mfaStateFor(userId);
  // Codes only exist once two-step sign-in is on.
  if (!state.enabled) return Response.json({ error: "mfa-not-enabled" }, { status: 409 });
  if (!hasFreshCheck(true, session as SessionWithMfa, now)) {
    return Response.json({ error: "fresh-check-required" }, { status: 403 });
  }

  const recoveryCodes = await issueRecoveryCodes(userId, now);
  const epoch = await bumpSecurityEpoch(userId);
  // An `epoch` proof: this session already holds a second factor and presented none
  // here, so it takes the new epoch and leaves its fresh-check time as it was.
  return Response.json({ recoveryCodes, proof: mintSecondFactorProof(userId, sid, "epoch", epoch, now) });
}
