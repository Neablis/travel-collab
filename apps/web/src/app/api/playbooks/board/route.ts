import { auth } from "@/server/auth";
import { LeaderboardResponse } from "@/lib/playbooks";
import { leaderboard } from "@/server/playbooks";

export const runtime = "nodejs";

// The leaderboard (M11b link 7). Ranks on the adds ledger and nothing else —
// not ratings, not post volume. `server/playbooks.ts`'s `leaderboard` carries
// the reasoning for counting the ledger rather than the denormalised counter.
//
// `meUserId` rides along because the page has to tint and badge YOUR row
// without pinning it, and the browser is not handed the signed-in id to compare
// against. Same reason `GET /api/saved-days/:id` returns `isAuthor`.
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  return Response.json(
    LeaderboardResponse.parse({ authors: await leaderboard(), meUserId: session.user.id }),
  );
}
