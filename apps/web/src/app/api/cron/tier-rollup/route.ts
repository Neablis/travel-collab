// The Vercel Cron entry point for the weekly tier rollup (M47 part 4). Once
// daily at 04:30 UTC (`apps/web/vercel.json`) Vercel GETs this route with
// `Authorization: Bearer ${CRON_SECRET}`; the secret is checked before any
// database work. Daily, though the rows are weekly: each run rewrites this
// week's, so a missed day heals on the next.
//
// **Imports nothing from `server/ai/`** (KI-2026-10-17-a): its own route
// rather than a step in `embed-days`, so the console's history stays out of
// the AI module's import graph.
import { isCronRequestAuthorized } from "@/server/cronAuth";
import { rollupTiers } from "@/server/entitlements/tierRollup";

// A cached 200 would report a count from a run that never happened.
export const dynamic = "force-dynamic";

/** Write this week's tier counts. Unauthorised without the cron secret, by `cronAuth`. */
export async function GET(request: Request): Promise<Response> {
  if (!isCronRequestAuthorized(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  return Response.json(await rollupTiers());
}
