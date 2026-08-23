import { aiLive } from "@/server/ai/modelSelection";

// KI-25: whether an e2e run is actually simulated depends on how the dev
// server was started (playwright.config.ts's webServer.env only applies
// when Playwright starts a fresh server, not against an already-running
// `pnpm dev`). This makes the effective mode queryable rather than
// inferable — e2e/global.setup.ts checks it before anything else runs and
// refuses to proceed against a live model. Also the missing observability
// KI-24 names for AI_LIVE on Vercel: the mode is now visible, not just
// warned about in a log line. Unauthenticated on purpose — it reports a
// boolean, nothing user- or trip-scoped, and needs to be queryable before
// any e2e spec has signed in.
export async function GET() {
  return Response.json({ live: await aiLive() });
}
