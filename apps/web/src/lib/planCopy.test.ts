import { describe, expect, it, vi } from "vitest";
import { formatDate } from "./planCopy";

// **Two kinds of test here, because one kind cannot do the job alone.**
//
// The defect being pinned — a billing boundary rendered in the reader's zone
// instead of UTC — is invisible on a UTC runner, and CI pins no `TZ`. The
// date-literal assertions below therefore fail on any developer machine west of
// Greenwich and pass in CI whether or not `formatDate` names a time zone. That
// asymmetry is exactly how the bug reached `main`: nothing red ever ran in a
// negative-offset zone.
//
// So the last test asserts the OPTION rather than the output. It is white-box
// on purpose — normally a smell, but here the invariant genuinely IS "the
// formatter is told UTC", and it is the only form of the assertion that fails
// on a UTC runner when the option is removed. (CodeRabbit, PR #178.)
//
// The alternative CodeRabbit also offered — pinning a negative-offset `TZ` for
// the suite — was not taken: `TZ` is process-level and Node caches the zone on
// first use, so a per-file assignment is order-dependent and quietly does
// nothing when another suite has already formatted a date. Pinning it for the
// whole lane would work and would make every date test in the repo honest, but
// that is a change with suite-wide blast radius and belongs in its own PR.
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

  // The half a UTC runner cannot observe. Removing `timeZone: "UTC"` from
  // `formatDate` leaves every assertion above green in CI; it turns this one
  // red anywhere.
  it("tells the formatter to use UTC, whatever zone the runner is in", () => {
    const real = Intl.DateTimeFormat;
    const seen: Intl.DateTimeFormatOptions[] = [];
    // A `function`, not an arrow: `formatDate` calls this with `new`, and
    // vitest refuses to construct an arrow mock.
    const spy = vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function (
      locales?: Intl.LocalesArgument,
      options?: Intl.DateTimeFormatOptions,
    ) {
      if (options !== undefined) seen.push(options);
      return new real(locales, options);
    } as never);

    try {
      formatDate("2026-10-20T00:00:00.000Z");
    } finally {
      spy.mockRestore();
    }

    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual(expect.objectContaining({ timeZone: "UTC" }));
  });
});
