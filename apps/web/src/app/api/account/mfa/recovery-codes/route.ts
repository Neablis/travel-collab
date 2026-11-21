import type { SessionWithMfa } from "@/lib/authConfig";
import { auth } from "@/server/auth";
import { recordSecurityChange } from "@/server/mfa/changes";
import { hasFreshCheck, mfaStateFor } from "@/server/mfa/state";
import { issueRecoveryCodes } from "@/server/mfa/recoveryCodes";

// *Regenerate* (M62 D7): ten new codes, shown once, and the old set voided, spent
// codes included. It bumps the epoch like every change to how an account is
// entered, which signs out the other sessions; this one is handed a proof so it is
// not signed out with them.
export async function POST(request: Request) {
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

  // The proof is an `epoch` one: this session already holds a second factor and
  // presented none here, so it takes the new epoch and leaves its fresh-check
  // time as it was.
  const { result: recoveryCodes, proof } = await recordSecurityChange({
    userId,
    sid,
    change: "codes-regenerated",
    request,
    now,
    apply: (tx) => issueRecoveryCodes(userId, now, tx),
  });
  return Response.json({ recoveryCodes, proof });
}
