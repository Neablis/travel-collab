import { request } from "@playwright/test";
import { BASE_URL } from "../src/config";

// KI-25: playwright.config.ts's webServer.env sets AI_LIVE=false, but that
// block only applies when Playwright starts a fresh server
// (reuseExistingServer: !process.env.CI) — against an already-running dev
// server, whatever AI_LIVE that server actually has wins, silently. Query
// the running server's actual resolved mode instead of trusting how it was
// started, and refuse to run at all if it would make a real, billable model
// call. Runs once, before every project (including "setup"), via
// playwright.config.ts's `globalSetup`.
export default async function globalSetup(): Promise<void> {
  const context = await request.newContext();
  try {
    const res = await context.get(`${BASE_URL}/api/health/ai-mode`);
    // Fail closed: an unreachable endpoint, a non-2xx response, or a body
    // that doesn't parse should refuse the run rather than let `live` come
    // back `undefined` and silently pass the check below — a health check
    // that fails open is worse than no health check.
    const body = res.ok() ? await res.json().catch(() => undefined) : undefined;
    // `source: "env"` is required, not just `live: false`, and that is a real
    // tightening rather than belt-and-braces. Since the `ai-live` flag became
    // per-user targetable (ADR-019 amendment 2026-09-08), a `live: false` that
    // came from the FLAG was evaluated for this unauthenticated probe — it says
    // nothing about the signed-in user the specs then sign in as, who a
    // targeting rule could perfectly well put on a real model. Only AI_LIVE
    // decides for everyone at once, so only AI_LIVE can clear a whole suite.
    // Set it (`.env.example` ships `AI_LIVE=false`; CI sets it in the workflow
    // env) — an unset AI_LIVE is now a refusal, on purpose.
    if (!res.ok() || body?.live !== false || body?.source !== "env") {
      throw new Error(
        `Could not verify AI_LIVE=false (GET /api/health/ai-mode -> ${res.status()}, body: ${JSON.stringify(body)}). ` +
          "Refusing to run e2e against a server whose AI mode isn't confirmed simulated for every user. " +
          'Set AI_LIVE=false in the server\'s environment — a mode resolved from the flag ("source":"flag") ' +
          "is per-user and cannot clear the suite.",
      );
    }
  } finally {
    await context.dispose();
  }
}
