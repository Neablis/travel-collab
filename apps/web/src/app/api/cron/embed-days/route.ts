// The Vercel Cron entry point for the plan-retrieval embed queue (Part 2 of
// 5). Every 5 minutes (see `apps/web/vercel.json`) Vercel GETs this route
// with `Authorization: Bearer ${CRON_SECRET}`; the handler verifies the
// secret FIRST — before any database work — and runs the sweep.
import { isCronRequestAuthorized } from "@/server/cronAuth";
import { runEmbedSweep } from "@/server/ai/sweep";

// A cron invocation is never cacheable: the sweep drains a live queue, and a
// cached 200 would report yesterday's counts while rows pile up.
export const dynamic = "force-dynamic";

/** Drain the embed queue. Unauthorised without the cron secret, by `cronAuth`. */
export async function GET(request: Request): Promise<Response> {
  if (!isCronRequestAuthorized(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const summary = await runEmbedSweep();
  return Response.json(summary);
}
