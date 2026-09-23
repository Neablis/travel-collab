import { InviteLanding } from "@tc/contracts";
import { auth } from "@/server/auth";
import { readInviteLanding } from "@/server/inviteLanding";

/**
 * `GET /api/invites/:token` — the invite landing's one read (M27 link 6).
 *
 * **No session required**, and that is the change from the preview this
 * replaced. An invite link is opened by people who have no account yet, and
 * the screen it opens has to say who asked and what the trip is before it can
 * ask them to make one (SPEC §35.6). The session is read only to answer two
 * questions a signed-in reader adds: are they already on this trip (`member`),
 * and should the screen offer *Sign in*.
 *
 * Every state is a body, not only `valid`: the screen draws revoked and
 * unavailable too, so the status code keeps its old meaning (404 unknown,
 * 410 gone) and the body says which screen to draw. The parse is what holds a
 * refusal to its state alone — see `InviteLanding`'s `.strict()` objects.
 *
 * Not rate-limited, the same as `GET /api/shares/:token`, the other read a
 * stranger can make: the token is 256 bits of entropy (`mintToken`), so there
 * is nothing to enumerate.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const session = await auth();
  const { token } = await params;
  const { status, landing } = await readInviteLanding(token, session?.user?.id ?? null);
  return Response.json({ landing: InviteLanding.parse(landing) }, { status });
}
