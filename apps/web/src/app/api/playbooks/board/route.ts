import { LeaderboardResponse } from "@/lib/playbooks";
import { leaderboard } from "@/server/playbooks";
import { withDeprecatedLeaderboardAlias } from "@/server/playbookWireAliases";
import { publicLibraryReader } from "@/server/publicLibraryLimit";

export const runtime = "nodejs";

// The leaderboard (M11b link 7). Ranks on the adds ledger and nothing else —
// not ratings, not post volume. `server/playbooks.ts`'s `leaderboard` carries
// the reasoning for counting the ledger rather than the denormalised counter.
//
// `meUserId` rides along because the page has to tint and badge YOUR row
// without pinning it, and the browser is not handed the signed-in id to compare
// against. Same reason `GET /api/saved-days/:id` returns `isAuthor`. A reader
// with no account (ADR-061) has no row, so theirs is `null`.
export async function GET(request: Request) {
  const reader = await publicLibraryReader(request);
  if ("refused" in reader) return reader.refused;
  return Response.json(
    withDeprecatedLeaderboardAlias(
      LeaderboardResponse.parse({ authors: await leaderboard(), meUserId: reader.readerId }),
    ),
  );
}
