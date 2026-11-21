import type { SessionWithMfa } from "@/lib/authConfig";
import { auth } from "@/server/auth";
import { recordSecurityChange, revokeAllCredentials, turnOffIn } from "@/server/mfa/changes";
import { hasFreshCheck, mfaStateFor } from "@/server/mfa/state";

// *Turn off two-step sign-in* (DELETE) and *Also revoke all tokens and connected
// apps* (POST), M62 D7 and D8. Both ask for the fresh check; a 403 and a name
// opens the screen's check, as for adding a factor.
async function signedIn() {
  const session = await auth();
  const userId = session?.user?.id;
  const sid = (session as SessionWithMfa | null)?.sid;
  return userId === undefined || userId === "" || !sid ? null : { session: session as SessionWithMfa, userId, sid };
}

/** Removes every factor and every recovery code, signs out every other session and emails the account. */
export async function DELETE(request: Request) {
  const who = await signedIn();
  if (who === null) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const now = new Date();
  if (!(await mfaStateFor(who.userId)).enabled) return Response.json({ error: "mfa-not-enabled" }, { status: 409 });
  if (!hasFreshCheck(true, who.session, now)) return Response.json({ error: "fresh-check-required" }, { status: 403 });

  const { proof } = await recordSecurityChange({
    userId: who.userId,
    sid: who.sid,
    change: "two-step-off",
    request,
    now,
    apply: (tx) => turnOffIn(tx, who.userId),
  });
  return Response.json({ proof });
}

/**
 * Revokes every API token and OAuth grant. It changes no way of signing in, so it
 * bumps no epoch and sends no email: it is what the person ticked while turning
 * two-step sign-in on, in the same sitting.
 */
export async function POST() {
  const who = await signedIn();
  if (who === null) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const now = new Date();
  const { enabled } = await mfaStateFor(who.userId);
  if (!hasFreshCheck(enabled, who.session, now)) return Response.json({ error: "fresh-check-required" }, { status: 403 });
  return Response.json(await revokeAllCredentials(who.userId, now));
}
