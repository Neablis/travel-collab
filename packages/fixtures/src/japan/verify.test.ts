import { describe, expect, it } from "vitest";
import { diffAgainstExpectations, JAPAN_TRIP_EXPECTATIONS } from "./expectations.ts";
import { japanTripCommands } from "./commands.ts";
import { deterministicMintId, formatReport, REFERENCE_START_DATE, verifyJapanTrip } from "./verify.ts";

describe("the canonical Japan fixture", () => {
  const report = verifyJapanTrip();

  // `pnpm seed:verify` sets this; `pnpm check` does not.
  if (process.env.SEED_VERIFY_REPORT) console.log(`\n${formatReport(report, diffAgainstExpectations(report))}\n`);

  // The whole point of the package, in one assertion. When this fails, read the
  // findings: each one names the expectation that moved.
  it("still matches its recorded expectations", () => {
    expect(diffAgainstExpectations(report)).toEqual([]);
  });

  it("is produced deterministically", () => {
    const a = japanTripCommands("00000000-0000-4000-8000-00000000f000", {
      startDate: REFERENCE_START_DATE,
      mintId: deterministicMintId(),
    });
    const b = japanTripCommands("00000000-0000-4000-8000-00000000f000", {
      startDate: REFERENCE_START_DATE,
      mintId: deterministicMintId(),
    });
    expect(a).toEqual(b);
  });

  // A guard on the guard. `diffAgainstExpectations` reports findings rather
  // than throwing, so a bug that made it always return [] would leave the
  // suite green while checking nothing — the same species as a property test
  // that asserts zero times (AGENTS.md, "Property tests carry a witness").
  it("reports a finding when an expectation is wrong", () => {
    const findings = diffAgainstExpectations(report, { ...JAPAN_TRIP_EXPECTATIONS, activityCount: 71 });
    expect(findings).toContain("activityCount: expected 71, got 72");
  });

  it("covers every ActivityKind and every ActivityTag", () => {
    for (const [kind, n] of Object.entries(report.kinds)) expect(n, `kind ${kind}`).toBeGreaterThan(0);
    for (const [tag, n] of Object.entries(report.tags)) expect(n, `tag ${tag}`).toBeGreaterThan(0);
  });
});
