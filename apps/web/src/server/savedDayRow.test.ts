import { describe, expect, it, vi, afterEach } from "vitest";
import type { SavedStop } from "@tc/contracts";
import { parseSavedDayColumns } from "./savedDayRow";

// The read boundary both a library read and a Discover read go through
// (F-F05). Every case here is about a row that is ALREADY IN THE DATABASE —
// which is why the consequences differ so much between them: dropping a row is
// a person's Playbook disappearing out of their library (KI-20260905-l), and
// the whole of ADR-048 decision 3 is about which failures are worth that.

const ID = "aa000000-0000-4000-8000-000000000001";

/** A stop as the bytes hold it — `dayIndex` optional, exactly like a stored row. */
function stop(title: string, dayIndex?: number): Record<string, unknown> {
  return {
    title,
    timeWindow: null,
    location: null,
    notes: null,
    anchors: [],
    kind: "planned",
    tags: [],
    cost: null,
    ...(dayIndex === undefined ? {} : { dayIndex }),
  };
}

function row(over: Partial<Parameters<typeof parseSavedDayColumns>[0]> = {}) {
  return parseSavedDayColumns({
    savedDayId: ID,
    stops: [stop("Fushimi Inari"), stop("Nishiki")],
    visibility: "private",
    authorKind: "human",
    dayCount: 1,
    ...over,
  });
}

afterEach(() => vi.restoreAllMocks());

describe("a row written before M23", () => {
  // The migration's whole promise, and the gate box that checks it: an existing
  // Playbook is a sequence of length one, not a special case and not a loss.
  it("reads as a one-day sequence with its stops in the stored order", () => {
    const parsed = row({ stops: [stop("Fushimi Inari"), stop("Nishiki")], dayCount: 1 });
    expect(parsed).not.toBeNull();
    expect(parsed!.stops.map((s) => s.title)).toEqual(["Fushimi Inari", "Nishiki"]);
    expect(parsed!.stops.map((s) => s.dayIndex)).toEqual([0, 0]);
    expect(parsed!.dayCount).toBe(1);
  });

  // `day_count` did not exist before the migration. A row read through a path
  // that never selected it must not come back as a zero-day Playbook.
  it("reads as one day when day_count is missing entirely", () => {
    const parsed = row({ dayCount: undefined });
    expect(parsed!.dayCount).toBe(1);
  });
});

describe("dayIndex order is tolerated, never enforced", () => {
  // ADR-048 decision 3. Enforcing here would drop a row whose stops are each
  // individually valid — the hazard KI-20260905-l was opened about, re-created
  // on purpose. The write path is where monotonicity is refused.
  it("sorts a scrambled row instead of dropping it", () => {
    const parsed = row({
      stops: [stop("day two", 1), stop("day one", 0), stop("day two later", 1)],
      dayCount: 2,
    });
    expect(parsed).not.toBeNull();
    expect(parsed!.stops.map((s) => s.title)).toEqual(["day one", "day two", "day two later"]);
  });

  // Within a day, stops are in the order the day RAN, not clock order — so the
  // sort has to be stable or it silently reorders a day while appearing to fix
  // its days.
  it("is stable, so a day's own stop order survives the sort", () => {
    const parsed = row({
      stops: [stop("b", 1), stop("c", 1), stop("a", 0)],
      dayCount: 2,
    });
    expect(parsed!.stops.map((s) => s.title)).toEqual(["a", "b", "c"]);
  });

  it("says so in the log, so a write-path regression is not silent", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    row({ stops: [stop("second", 1), stop("first", 0)], dayCount: 2 });
    expect(logged).toHaveBeenCalledWith(
      "saved_days.stops were not in dayIndex order; sorted on read",
      expect.objectContaining({ savedDayId: ID }),
    );
  });

  it("does not log when the row was already in order", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    row({ stops: [stop("first", 0), stop("second", 1)], dayCount: 2 });
    expect(logged).not.toHaveBeenCalled();
  });
});

describe("dayCount is floored by its stops", () => {
  // Repaired UPWARD only. Clamping down would strand a day's stops in a day the
  // count says does not exist, and refusing the row would empty a library over
  // arithmetic.
  it("grows to fit stops that reach past it", () => {
    const parsed = row({ stops: [stop("a", 0), stop("c", 2)], dayCount: 1 });
    expect(parsed!.dayCount).toBe(3);
  });

  // The trailing empty day — the one thing a gap in `dayIndex` cannot express,
  // and the entire reason the column is stored (ADR-048 decision 2).
  it("keeps a stored count that is LARGER than its stops reach", () => {
    const parsed = row({ stops: [stop("a", 0)], dayCount: 3 });
    expect(parsed!.dayCount).toBe(3);
  });

  it("falls back to the floor when the stored value is not an integer", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const parsed = row({ stops: [stop("a", 0), stop("b", 1)], dayCount: "two" });
    expect(parsed!.dayCount).toBe(2);
  });
});

describe("what still fails closed", () => {
  // Unchanged by M23, and deliberately: an unreadable fragment cannot be
  // rendered, and an unknown visibility is a value no access check has a branch
  // for. Both decide what a reader may SEE.
  it("drops a row whose stops are not SavedStops", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(row({ stops: [{ title: "no kind" }] })).toBeNull();
  });

  it("drops a row whose visibility is not a SavedDayVisibility", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(row({ visibility: "quarantined" })).toBeNull();
  });

  // ...but authorKind decides a LABEL, so it falls back rather than costing
  // somebody their Playbook.
  it("falls back to human on an unreadable author_kind, and keeps the row", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const parsed = row({ authorKind: "robot" });
    expect(parsed).not.toBeNull();
    expect(parsed!.authorKind).toBe("human");
  });
});

// A stop's type says `dayIndex: number`; the stored bytes may not have one.
// This is the cast the rest of the suite leans on being safe.
describe("the parsed output is a real SavedStop", () => {
  it("fills dayIndex in from the default rather than leaving it undefined", () => {
    const parsed = row({ stops: [stop("legacy")] });
    const first: SavedStop = parsed!.stops[0]!;
    expect(first.dayIndex).toBe(0);
  });
});
