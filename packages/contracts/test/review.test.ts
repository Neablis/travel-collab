import { describe, expect, it } from "vitest";
import {
  AdminReportAction,
  CreateReportInput,
  PutReviewInput,
  REVIEW_NOTE_MAX,
  ReportTarget,
  ReviewNote,
  ReviewStars,
  ReviewSummary,
} from "../src";

const savedDayId = "3c5e7f90-2222-4333-8444-555566667777";

describe("ReviewStars", () => {
  it.each([1, 2, 3, 4, 5])("accepts %d", (stars) => {
    expect(ReviewStars.parse(stars)).toBe(stars);
  });

  it.each<[unknown]>([[0], [6], [4.5], [-1], ["5"], [null]])("refuses %j", (stars) => {
    expect(ReviewStars.safeParse(stars).success).toBe(false);
  });
});

// M12's gate box: "a note longer than 140 characters is refused at the
// contract boundary, not truncated silently in the UI". The boundary is pinned
// on both sides, after trimming, and in CODE POINTS — the unit the database's
// `char_length` CHECK counts. A `.max(140)` would count UTF-16 code units and
// refuse a 71-emoji note the column would happily hold.
describe("ReviewNote", () => {
  it("is 140 characters", () => {
    expect(REVIEW_NOTE_MAX).toBe(140);
  });

  it("accepts exactly the limit and refuses one past it", () => {
    expect(ReviewNote.parse("a".repeat(140))).toBe("a".repeat(140));
    expect(ReviewNote.safeParse("a".repeat(141)).success).toBe(false);
  });

  it("counts code points, not UTF-16 units", () => {
    const astral = "\u{1F5FB}"; // two code units, one character
    expect(ReviewNote.parse(astral.repeat(140))).toBe(astral.repeat(140));
    expect(ReviewNote.safeParse(astral.repeat(141)).success).toBe(false);
  });

  it("measures after trimming, and stores the trimmed text", () => {
    expect(ReviewNote.parse(`  ${"a".repeat(140)}  `)).toBe("a".repeat(140));
  });

  it.each<[unknown]>([[""], ["   "], [null]])("reads %j as no note", (note) => {
    expect(ReviewNote.parse(note)).toBeNull();
  });
});

describe("PutReviewInput", () => {
  it("needs only stars; the note defaults to none and the conflict check is opt-in", () => {
    expect(PutReviewInput.parse({ stars: 4 })).toEqual({ stars: 4, note: null });
  });

  it("carries seenPublishedAt as an ISO instant or null", () => {
    expect(PutReviewInput.parse({ stars: 4, seenPublishedAt: null }).seenPublishedAt).toBeNull();
    expect(PutReviewInput.parse({ stars: 4, seenPublishedAt: "2026-09-20T10:00:00.000Z" }).seenPublishedAt).toBe(
      "2026-09-20T10:00:00.000Z",
    );
    expect(PutReviewInput.safeParse({ stars: 4, seenPublishedAt: "two days ago" }).success).toBe(false);
  });
});

describe("ReviewSummary", () => {
  it("requires every bucket, 1 through 5", () => {
    const histogram = { 1: 0, 2: 0, 3: 1, 4: 0, 5: 2 };
    expect(ReviewSummary.parse({ average: 13 / 3, count: 3, histogram }).histogram).toEqual(histogram);
    const { 3: _dropped, ...missing } = histogram;
    expect(ReviewSummary.safeParse({ average: 13 / 3, count: 3, histogram: missing }).success).toBe(false);
  });
});

describe("ReportTarget", () => {
  it("names a review by its day and its reviewer", () => {
    expect(ReportTarget.safeParse({ kind: "review", savedDayId }).success).toBe(false);
    expect(ReportTarget.parse({ kind: "review", savedDayId, reviewerId: "dev-bob" })).toEqual({
      kind: "review",
      savedDayId,
      reviewerId: "dev-bob",
    });
  });
});

describe("CreateReportInput", () => {
  it("caps the note at 500 and reads an empty one as none", () => {
    const target = { kind: "saved_day", savedDayId };
    expect(CreateReportInput.parse({ target, reason: "spam", note: "  " }).note).toBeNull();
    expect(CreateReportInput.parse({ target, reason: "spam", note: "x".repeat(500) }).note).toHaveLength(500);
    expect(CreateReportInput.safeParse({ target, reason: "spam", note: "x".repeat(501) }).success).toBe(false);
  });

  it("refuses a reason outside the enum", () => {
    expect(CreateReportInput.safeParse({ target: { kind: "saved_day", savedDayId }, reason: "boring" }).success).toBe(
      false,
    );
  });
});

describe("AdminReportAction", () => {
  it.each(["hide-day", "hide-review", "dismiss", "restore-day", "restore-review"])("accepts %s", (action) => {
    expect(AdminReportAction.parse({ action }).action).toBe(action);
  });

  it("refuses an unknown action", () => {
    expect(AdminReportAction.safeParse({ action: "delete-day" }).success).toBe(false);
  });
});
