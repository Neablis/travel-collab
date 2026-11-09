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
    // `source: "env"` is required, not just `live: false`: a `live: false` from
    // the FLAG may be only an unset default, which a later `FLAG_AI_LIVE=true`
    // turns into a real model for the whole suite. Only an explicit AI_LIVE is
    // a decision, so only AI_LIVE can clear a suite. Set it (`.env.example`
    // ships `AI_LIVE=false`; CI sets it in the workflow env) — an unset AI_LIVE
    // is a refusal, on purpose.
    if (!res.ok() || body?.live !== false || body?.source !== "env") {
      throw new Error(
        `Could not verify AI_LIVE=false (GET /api/health/ai-mode -> ${res.status()}, body: ${JSON.stringify(body)}). ` +
          "Refusing to run e2e against a server whose AI mode isn't confirmed simulated for every user. " +
          'Set AI_LIVE=false in the server\'s environment — a mode resolved from the flag ("source":"flag") ' +
          "may be an unset default and cannot clear the suite.",
      );
    }
  } finally {
    await context.dispose();
  }
}
