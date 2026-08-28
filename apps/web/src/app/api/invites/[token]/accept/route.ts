import { auth } from "@/server/auth";
import { acceptInvite } from "@/server/access/invites";

const STATUS: Record<string, number> = { "not-found": 404, gone: 410, forbidden: 403, invalid: 400 };

export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const { token } = await params;
  const result = await acceptInvite(token, session.user.id);
  if (!result.ok) {
    return Response.json(
      { error: result.error.message, code: result.error.code },
      { status: STATUS[result.error.code] ?? 400 },
    );
  }
  return Response.json({ tripId: result.value.tripId, role: result.value.role });
}
