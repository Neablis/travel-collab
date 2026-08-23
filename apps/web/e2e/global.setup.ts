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
  const res = await context.get(`${BASE_URL}/api/health/ai-mode`);
  const { live } = await res.json();
  await context.dispose();
  if (live) {
    throw new Error(
      "Refusing to run e2e against a live AI model (GET /api/health/ai-mode reported live: true). " +
        "Set AI_LIVE=false, or stop whatever dev server is already running and let this config start its own.",
    );
  }
}
