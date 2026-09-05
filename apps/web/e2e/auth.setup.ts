import { test as setup } from "@playwright/test";
import { signInAsDevUser } from "./helpers";

// Runs once per test:e2e invocation, before the "desktop"/"narrow" projects
// (see playwright.config.ts's `dependencies`). Every other spec starts
// already authenticated via this saved storageState instead of repeating
// the full sign-in flow — Task 3.1: 24 signInAsDevUser calls across 15 tests
// down to 2 (this file, plus smoke.spec.ts's own deliberate signed-out
// flow, the one place the login UI is still covered end to end).
//
// M11a: alice has no `users` row against a fresh database, so this sign-in is
// itself a trip through the invite gate — `signInAsDevUser` presents the super
// code `playwright.config.ts` gave the server. If that pairing ever breaks,
// this file is where the whole run stops, and the symptom is every project
// failing at once with no storage state written.
// eslint-disable-next-line playwright/expect-expect -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
setup("authenticate as alice", async ({ page }) => {
  await signInAsDevUser(page, "alice");
  await page.context().storageState({ path: ".auth/alice.json" });
});
