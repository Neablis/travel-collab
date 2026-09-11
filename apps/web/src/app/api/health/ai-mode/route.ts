import { aiLiveMode, resolvedTierMap } from "@/server/ai/modelSelection";

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
// `tiers` answers the OTHER half — not whether AI is live, but WHAT is
// running (ADR-043 decision 4, spec §5b).
//
// Until P5 this endpoint reported the mode and nothing else, so "which models
// is production actually on?" was answerable only by reading environment
// variables in a dashboard — which is precisely how a compiled default goes
// unnoticed. `config.ts` compiles `anthropic/claude-haiku-4-5` while production
// sets `AI_MODEL` to `deepseek/deepseek-v4-flash-0731`, and M20 link 5 records
// that gap already costing one cost estimate an order of magnitude, with the
// note that *"this mistake was made once already while scoping this
// milestone."* One field, and the question is answerable from outside.
//
// It reports **resolved ids**, which is the only version of this worth
// shipping: a map naming the environment variables rather than their values
// would have been equally silent about the same defect.
//
// Safe to be unauthenticated for the same reason the rest of the body is: a
// model id is operator configuration, not a secret and not a fact about any
// user — the gateway key is what carries the spend, and it appears nowhere
// here. It is reported on every deployment rather than only when live, because
// a simulated deployment's configured ids are exactly what an operator needs to
// check BEFORE switching the flag on.
export async function GET() {
  const { live, source } = await aiLiveMode();
  return Response.json({ live, source, tiers: resolvedTierMap() });
}
