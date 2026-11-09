import { aiLiveMode, resolvedTierMap } from "@/server/ai/modelSelection";
import { deployEnv } from "@/lib/deployment/env";

// KI-25: whether an e2e run is actually simulated depends on how the dev
// server was started (playwright.config.ts's webServer.env only applies
// when Playwright starts a fresh server, not against an already-running
// `pnpm dev`). This makes the effective mode queryable rather than
// inferable — e2e/global.setup.ts checks it before anything else runs and
// refuses to proceed against a live model. Also the missing observability
// KI-24 names for AI_LIVE on Vercel: the mode is now visible, not just
// warned about in a log line.
//
// `source` says what decided that answer. `"env"` means AI_LIVE decided it,
// deliberately, for this server; `"flag"` means `FLAG_AI_LIVE` answered, and an
// unset flag is a default, not a decision. Since M59 both are global to the
// process, but e2e's global setup still requires `"env"`: a suite must not be
// cleared to run on a default someone forgot to set.
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
// ran `deepseek/deepseek-v4-flash-0731` (and now names a model per tier), and
// M20 link 5 records that gap already costing one cost estimate an order of
// magnitude, with the note that *"this mistake was made once already while
// scoping this milestone."* One field, and the question is answerable from outside.
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
//
// `environment` is which deployment environment answered: `APP_ENV` / `VERCEL_ENV` exactly,
// or null when it is unset — off Vercel, or on a project that does not expose
// system environment variables. Null is never guessed into "development": the
// live-set script treats that word as permission, and a production deployment
// with the variable hidden must not be able to grant it. It is how a script that spends real model calls
// (`scripts/assistant-live-set.mjs`) refuses production: a deployment's own
// URL looks the same on a preview and on production, so the hostname is no
// evidence, and only the deployment can say which it is. Not a secret.
export async function GET() {
  const { live, source } = await aiLiveMode();
  return Response.json({
    live,
    source,
    tiers: resolvedTierMap(),
    environment: deployEnv() ?? null,
  });
}
