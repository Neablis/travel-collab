import { auth } from "@/server/auth";
import { getTripDetail } from "@/server/projections";

// Explicit return type: without it, TS infers complementary optional keys
// (`{ error: Response; userId?: undefined } | { userId: string; error?: undefined }`)
// on the union, which defeats `"error" in g` narrowing under strict mode.
type GuardResult = { error: Response } | { userId: string };

export async function guard(tripId: string): Promise<GuardResult> {
  const session = await auth();
  if (!session?.user?.id) return { error: Response.json({ error: "unauthenticated" }, { status: 401 }) };
  const detail = await getTripDetail(tripId);
  if (detail === null) return { error: Response.json({ error: "not-found" }, { status: 404 }) };
  if (!detail.members.some((m) => m.userId === session.user!.id)) return { error: Response.json({ error: "forbidden" }, { status: 403 }) };
  return { userId: session.user.id };
}
