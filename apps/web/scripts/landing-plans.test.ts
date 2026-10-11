import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildLandingPlans, serializeLandingPlans, SNAPSHOT_PATH } from "./landing-plans";

// `pnpm landing:plans:verify`, inside `pnpm test`. The landing's pricing
// section draws `landingPlans.generated.json`; publishing a plan version that
// moves a price or a ceiling fails here until the file is regenerated
// (`pnpm --filter web landing:plans:generate`), so the front door cannot quote
// a price the checkout no longer charges.
describe("the landing pricing's plan snapshot", () => {
  it("is exactly what the generator makes from the current plan file", () => {
    const committed = readFileSync(SNAPSHOT_PATH, "utf8");
    const fresh = serializeLandingPlans(buildLandingPlans());
    // Parsed first, so a failure names the field that moved rather than two
    // truncated strings; then byte for byte, as `landing:plans:verify` compares.
    expect(JSON.parse(committed)).toEqual(JSON.parse(fresh));
    expect(committed).toBe(fresh);
  });
});
