import type { MfaStatusResponse } from "@/lib/mfaWire";
import { auth } from "@/server/auth";
import { listFactors } from "@/server/mfa/factors";
import { mfaStateFor } from "@/server/mfa/state";

// What the Security tab's *Two-step sign-in* section draws from (M62): whether
// it is on, and the factors by name. Session-only, like every `/api/account/*`
// route. Whether an add is allowed this minute is not answered here: the add
// route says so itself, before it asks the authenticator for anything.
export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (userId === undefined || userId === "") return Response.json({ error: "unauthenticated" }, { status: 401 });
  const [state, factors] = await Promise.all([mfaStateFor(userId), listFactors(userId)]);
  const body: MfaStatusResponse = { enabled: state.enabled, factors };
  return Response.json(body);
}
