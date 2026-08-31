import { describe, expect, it } from "vitest";
import { ActivityKind, ActivityTag } from "@tc/contracts";
import { diffAgainstExpectations, JAPAN_TRIP_EXPECTATIONS } from "./expectations.ts";
import { JAPAN_SAVED_DAYS } from "./savedDays.ts";
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

  // The demo library (M11b). These are the properties M11b's exit gate rests
  // on, asserted here rather than left to the expectations diff, because a
  // diff can only say "3 became 2" — it cannot say why 3 mattered.
  it("carries two owners whose numbers a bug could not accidentally reconcile", () => {
    const owners = Object.entries(report.savedDaysByOwner);
    expect(owners.length).toBe(2);

    // "checked against a seed where they could disagree": if any of these three
    // pairs were equal, a build that credited one person's rows to the other
    // would still add up, and the gate box would pass on a broken profile.
    for (const field of ["days", "published", "adds"] as const) {
      const values = owners.map(([, owner]) => owner[field]);
      expect(new Set(values).size, `${field} is the same for both owners`).toBe(values.length);
    }

    // The half the loop above never covered, and the comment above it claimed
    // anyway: a swap WITHIN one owner. The profile header renders "days shared"
    // and "added to trips" side by side, so alice's days 3 / adds 3 was a pair a
    // page could read the wrong way round and still add up — three assertions
    // passed over it. Raised by review on pull request 102.
    for (const [id, owner] of owners) {
      const values = [owner.days, owner.published, owner.adds];
      expect(new Set(values).size, `two of ${id}'s own numbers are equal`).toBe(values.length);
    }
  });

  it("shares exactly one city between the two owners", () => {
    const [a, b] = Object.values(report.savedDaysByOwner);
    // Overlap, so a Kyoto query has to return both people's days; and
    // difference, so a Hakone query returns one person's. Neither alone
    // exercises Discover's matched/outlined city chips.
    const shared = a!.cities.filter((city) => b!.cities.includes(city));
    expect(shared).toEqual(["Kyoto"]);
    expect(a!.cities.filter((c) => !b!.cities.includes(c)).length).toBeGreaterThan(0);
    expect(b!.cities.filter((c) => !a!.cities.includes(c)).length).toBeGreaterThan(0);
  });

  it("carries a day that touches more than one city", () => {
    // Discover's per-card line ("Kyoto matched · also Uji") and its sibling
    // chips render nothing without one. M18 shipped tag chips against a
    // preview whose data had zero tags; this is the guard against the repeat.
    const multi = JAPAN_SAVED_DAYS.filter((day) => {
      const cities = new Set(day.stops.flatMap((s) => (s.location?.city ? [s.location.city] : [])));
      return cities.size > 1;
    });
    expect(multi.length).toBeGreaterThan(0);
  });

  // A guard on the guard, matching the `activityCount` one above: the
  // saved-day checks are new, and a diff that cannot fail is a diff that
  // proves nothing.
  it("reports a finding when a saved-day expectation is wrong", () => {
    const findings = diffAgainstExpectations(report, {
      ...JAPAN_TRIP_EXPECTATIONS,
      savedDayCount: 4,
    });
    expect(findings).toContain("savedDayCount: expected 4, got 5");
  });

  it("covers every ActivityKind and every ActivityTag", () => {
    // Witness floor first (AGENTS.md: "a property that skips every generated
    // case still reports ✓"). Both loops below iterate the report's own
    // histograms, so an EMPTY histogram asserts nothing and passes. What keeps
    // them non-empty is `verify.ts` seeding them from the enum's `options`;
    // counting only kinds that are present — the alternative its own comment
    // warns against — would make this test green and vacuous in one step.
    // (CodeRabbit, PR #74.)
    expect(Object.keys(report.kinds)).toHaveLength(ActivityKind.options.length);
    expect(Object.keys(report.tags)).toHaveLength(ActivityTag.options.length);

    for (const [kind, n] of Object.entries(report.kinds)) expect(n, `kind ${kind}`).toBeGreaterThan(0);
    for (const [tag, n] of Object.entries(report.tags)) expect(n, `tag ${tag}`).toBeGreaterThan(0);
  });
});
