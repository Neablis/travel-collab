import { aiLiveMode } from "@/server/ai/modelSelection";

// KI-25: whether an e2e run is actually simulated depends on how the dev
// server was started (playwright.config.ts's webServer.env only applies
// when Playwright starts a fresh server, not against an already-running
// `pnpm dev`). This makes the effective mode queryable rather than
// inferable — e2e/global.setup.ts checks it before anything else runs and
// refuses to proceed against a live model. Also the missing observability
// KI-24 names for AI_LIVE on Vercel: the mode is now visible, not just
// warned about in a log line.
//
// `source` says whether that answer is a fact about the SERVER or about the
// CALLER, and it exists because the `ai-live` flag became per-user targetable
// (ADR-019 amendment 2026-09-08). `"env"` means AI_LIVE decided it and the flag
// was never consulted, so no caller on this server can get a different answer;
// `"flag"` means Vercel Flags answered for whoever sent this request, and a
// targeting rule may well answer differently for the next person. Only `"env"`
// is evidence about anyone but the caller — which is exactly the distinction
// e2e's global setup has to make before it decides a suite is safe to run.
//
// Still unauthenticated, and still safe to be: with a session cookie it reports
// the caller's own mode, without one it reports the anonymous one. Neither
// tells you anything about another user, and it has to be queryable before any
// e2e spec has signed in.
export async function GET() {
  const { live, source } = await aiLiveMode();
  return Response.json({ live, source });
}
