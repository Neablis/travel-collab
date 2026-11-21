import type { MfaStatusResponse } from "@/lib/mfaWire";
import { auth } from "@/server/auth";
import { listFactors, recoveryCodesLeft } from "@/server/mfa/factors";
import { mfaStateFor } from "@/server/mfa/state";

// What the Security tab's *Two-step sign-in* section draws from (M62): whether
// it is on, and the factors by name. Session-only, like every `/api/account/*`
// route. Whether an add is allowed this minute is not answered here: the add
// route says so itself, before it asks the authenticator for anything.
/** The signed-in account's two-step status: on or off, its factors by name, and how many recovery codes are left. */
export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (userId === undefined || userId === "") return Response.json({ error: "unauthenticated" }, { status: 401 });
  const [state, factors, left] = await Promise.all([mfaStateFor(userId), listFactors(userId), recoveryCodesLeft(userId)]);
  const body: MfaStatusResponse = { enabled: state.enabled, factors, recoveryCodesLeft: left };
  return Response.json(body);
}
