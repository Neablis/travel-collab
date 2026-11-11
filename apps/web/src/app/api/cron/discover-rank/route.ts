// The cron entry point for the Discover rank (M61 part 2). Hourly at :17 a
// Coolify scheduled task (`docs/ops/coolify-vps.md`) GETs this route with
// `Authorization: Bearer ${CRON_SECRET}`; the secret is checked before any
// database work. Hourly because the score decays with time (ADR-090): a day's
// order drifts even when nobody touches it.
import { isCronRequestAuthorized } from "@/server/cronAuth";
import { recomputeDiscoverRanks } from "@/server/discoverRank";
import { invalidateDiscoverRank } from "@/server/libraryCache";

// A cached 200 would report a rewrite that never happened.
export const dynamic = "force-dynamic";

/** Rewrite every public day's rank row, then clear only the ranked page's cache. */
export async function GET(request: Request): Promise<Response> {
  if (!isCronRequestAuthorized(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  await recomputeDiscoverRanks();
  await invalidateDiscoverRank();
  return Response.json({ ok: true });
}

// Coolify's task is a `curl` GET; POST is the same handler for a manual run.
export const POST = GET;
