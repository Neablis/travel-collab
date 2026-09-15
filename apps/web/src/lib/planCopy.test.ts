import { describe, expect, it } from "vitest";
import { formatDate } from "./planCopy";

// **These tests are honest about what they can and cannot prove here.**
//
// The defect they pin — a billing boundary rendered in the reader's zone
// instead of UTC — is invisible on a UTC runner, and CI pins no `TZ`. So in CI
// they pass whether or not `formatDate` names a time zone, and on any developer
// machine west of Greenwich they fail unless it names UTC. That asymmetry is
// the point: the bug reached `main` precisely because nothing red ever ran in a
// negative-offset zone. Pinning `TZ` for the whole unit lane would make them
// bite everywhere; that is a broader change than this fix, and it is recorded
// as a follow-up rather than done quietly here.
describe("formatDate", () => {
  // The exact value that broke: `PlansScreen.test.tsx` serves
  // `effectiveAt: "2026-10-20T00:00:00.000Z"` and asserts the copy says
  // "October 20". Local formatting in America/Los_Angeles rendered
  // "October 19" — 5pm on the previous day.
  it("names the UTC calendar date of a midnight-UTC boundary", () => {
    expect(formatDate("2026-10-20T00:00:00.000Z")).toBe("October 20");
  });

  // The same hazard at a month edge, where being one day early also changes
  // the month — the shape most likely to be read as a different billing period
  // rather than as an off-by-one.
  it("does not roll a boundary back into the previous month", () => {
    expect(formatDate("2026-11-01T00:00:00.000Z")).toBe("November 1");
  });

  // A boundary that is NOT at midnight must land on its own UTC date too, so
  // the fix cannot be mistaken for "always subtract nothing at midnight".
  it("names the UTC date for a boundary later in the day", () => {
    expect(formatDate("2026-10-20T23:30:00.000Z")).toBe("October 20");
  });

  it("returns null for a missing or unparseable value rather than an Invalid Date", () => {
    expect(formatDate(null)).toBeNull();
    expect(formatDate("not a date")).toBeNull();
  });
});
