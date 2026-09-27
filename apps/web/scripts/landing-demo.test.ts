import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildLandingDemo, serializeLandingDemo, SNAPSHOT_PATH } from "./landing-demo";

// `pnpm landing:verify`, inside `pnpm test` — where the fixture's own check
// (`seed:verify`) and the content lint already run in CI. The front door's hero
// draws `landingDemo.generated.json`; a fixture or resolver change that moves
// what it would draw fails here until the file is regenerated
// (`pnpm --filter web landing:generate`).
describe("the landing hero's demo snapshot", () => {
  it("is exactly what the generator makes from the current fixture", () => {
    const committed = readFileSync(SNAPSHOT_PATH, "utf8");
    const fresh = serializeLandingDemo(buildLandingDemo());
    // Parsed first, so a failure names the field that moved rather than two
    // truncated strings; then byte for byte, as `landing:verify` compares.
    expect(JSON.parse(committed)).toEqual(JSON.parse(fresh));
    expect(committed).toBe(fresh);
  });

  // The spec's other promise about the file (§3.2): no calendar dates, because
  // `/demo` moves its dates and a frozen one would go stale.
  it("carries no calendar date", () => {
    expect(readFileSync(SNAPSHOT_PATH, "utf8")).not.toMatch(/\d{4}-\d{2}-\d{2}|\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/);
  });
});
