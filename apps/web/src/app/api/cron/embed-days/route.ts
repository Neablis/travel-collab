// The Vercel Cron entry point for the plan-retrieval embed queue (Part 2 of
// 5). Once daily at 04:00 UTC (see `apps/web/vercel.json`) Vercel GETs this
// route with `Authorization: Bearer ${CRON_SECRET}`; the handler verifies the
// secret FIRST — before any database work — and runs the sweep.
// NOTE: daily cadence is the Vercel Hobby plan limit. Bump to sub-daily (e.g.
// */15 * * * *) when traffic grows — requires Vercel Pro.
import { isCronRequestAuthorized } from "@/server/cronAuth";
import { runEmbedSweep } from "@/server/ai/sweep";

// A cron invocation is never cacheable: the sweep drains a live queue, and a
// cached 200 would report yesterday's counts while rows pile up.
export const dynamic = "force-dynamic";

// The sweep embeds up to `SWEEP_BATCH_SIZE` rows one after another, each with
// its own provider timeout; the platform default would cut a slow run short
// and leave its rows at `processing` until tomorrow's recovery. 300 is what the
// ask routes already run under on this plan.
export const maxDuration = 300;

/** Drain the embed queue. Unauthorised without the cron secret, by `cronAuth`. */
export async function GET(request: Request): Promise<Response> {
  if (!isCronRequestAuthorized(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const summary = await runEmbedSweep();
  return Response.json(summary);
}
