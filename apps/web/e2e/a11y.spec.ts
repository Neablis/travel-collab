import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/test";
import { createMappedTrip } from "./helpers";
import { e2eTripName } from "./tripNames";

// **The accessibility guard.** A static audit (the one Vercel's toolbar
// flags) found a dozen WCAG failures on pages every visitor sees — a /plans
// with no <main>, an invite page with no <h1>, rating stars at 1.4:1 — and
// none of them had a test that would have stopped it coming back. This runs
// axe-core over the front door and the two signed-in surfaces people spend
// their time on, and fails on any `serious` or `critical` violation.
//
// `moderate` and `minor` are not gated: axe reports best-practice findings at
// those levels (region, landmark-unique, heading-order) that are worth reading
// but are judgement calls, and a guard that fails on judgement calls gets
// switched off. The tags are WCAG 2.0 A/AA plus 2.1 A/AA — the level the
// product claims — and nothing beyond it.
//
// A page with a pre-existing serious violation that cannot be fixed where it
// is found is excluded RULE BY RULE, for that page only, with the reason
// written next to it. Never the whole page, never silently.

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/**
 * axe's serious and critical violations on the page as it stands, one entry
 * per rule with the selectors it failed on — the shape a failing
 * `toEqual([])` prints, so the diff names what broke and where.
 */
async function seriousViolations(page: Page, disableRules: string[] = []): Promise<{ id: string; impact: string; targets: string[] }[]> {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).disableRules(disableRules).analyze();
  return violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({ id: v.id, impact: v.impact ?? "", targets: v.nodes.map((n) => n.target.join(" ")) }));
}

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("the landing page", async ({ page }) => {
    await page.goto("/welcome");
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });

  test("sign in", async ({ page }) => {
    await page.goto("/signin");
    await expect(page.getByRole("button", { name: /sign in with dev login/i })).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });

  test("the playbook library", async ({ page }) => {
    await page.goto("/playbooks");
    await expect(page.getByLabel("Search cities and countries")).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });

  test("a demo trip", async ({ page }) => {
    await page.goto("/demo/japan");
    await expect(page.getByRole("heading", { name: "Japan: Tokyo → Kyoto → Osaka" })).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });
});

test.describe("signed in", () => {
  test("Home", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Your trips" })).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });

  test("a trip", async ({ page }) => {
    const tripId = await createMappedTrip(page, e2eTripName("a11y"), 3);
    await page.goto(`/trips/${tripId}`);
    await expect(page.getByRole("button", { name: /Trip settings/ })).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });
});
