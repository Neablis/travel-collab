// The cron entry point for the Discover rank (M61 part 2). Daily at 04:17 UTC a
// Coolify scheduled task (`docs/ops/coolify-vps.md`) GETs this route with
// `Authorization: Bearer ${CRON_SECRET}`; the secret is checked before any
// database work. It was hourly, because the score decays with time (ADR-090);
// it went daily on 2026-11-18, because every run woke Postgres and every clear
// sent the next visitor to each Discover list back to it, which kept a
// scale-to-zero database awake all day (ADR-090's amendment). Decay on a day
// scale needs no hourly rewrite, and the clear now happens only when the order
// a visitor would see actually moved.
import { isCronRequestAuthorized } from "@/server/cronAuth";
import { discoverRankOrder, recomputeDiscoverRanks } from "@/server/discoverRank";
import { invalidateDiscoverRank } from "@/server/libraryCache";

export const dynamic = "force-dynamic";

/** Whether two id lists hold the same ids in the same order. */
function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/**
 * Rewrite every public day's rank row, then clear the ranked pages' cache only
 * if the order moved. The order is read before and after the rewrite: a decayed
 * score changes every run, the order far less often, and an unneeded clear costs
 * a database read per place, author and tag list on its next visit. The rewrite
 * comes before the clear so no read re-caches the old order. A failed clear
 * throws, so the job does not answer ok over a stale page. The answer says
 * whether it cleared, for the run's log in Coolify.
 */
export async function GET(request: Request): Promise<Response> {
  if (!isCronRequestAuthorized(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const before = await discoverRankOrder();
  await recomputeDiscoverRanks();
  const cleared = !sameOrder(before, await discoverRankOrder());
  if (cleared) await invalidateDiscoverRank();
  return Response.json({ ok: true, cleared });
}
