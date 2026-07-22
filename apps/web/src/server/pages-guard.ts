import { auth } from "@/server/auth";
import { getTripDetail } from "@/server/projections";
import type { TripDetail } from "@tc/contracts";

// Explicit return type: without it, TS infers complementary optional keys
// (`{ error: Response; userId?: undefined; detail?: undefined } | { userId: string; detail: TripDetail; error?: undefined }`)
// on the union, which defeats `"error" in g` narrowing under strict mode.
//
// `detail` is included on success because `guard()` already fetches it
// internally to check membership — callers that also need the trip detail
// (e.g. the AI route) can reuse it instead of re-fetching. Callers that only
// need `userId` (the pages CRUD routes) simply ignore the extra field.
type GuardResult = { error: Response } | { userId: string; detail: TripDetail };

export async function guard(tripId: string): Promise<GuardResult> {
  const session = await auth();
  if (!session?.user?.id) return { error: Response.json({ error: "unauthenticated" }, { status: 401 }) };
  const detail = await getTripDetail(tripId);
  if (detail === null) return { error: Response.json({ error: "not-found" }, { status: 404 }) };
  if (!detail.members.some((m) => m.userId === session.user!.id)) return { error: Response.json({ error: "forbidden" }, { status: 403 }) };
  return { userId: session.user.id, detail };
}
