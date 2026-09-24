import { describe, expect, it } from "vitest";
import { MacroNode, PageContext, Page, CreatePageInput, DateRangeRef, PageCommand, UpdatePageInput } from "../src";

describe("page contracts", () => {
  it("accepts a valid inline macro node", () => {
    const node = { type: "macro", attrs: { name: "cost.trip", params: {} } };
    expect(MacroNode.parse(node).attrs.name).toBe("cost.trip");
  });

  it("accepts a block macro node carrying a day param", () => {
    const node = { type: "macro", attrs: { name: "itinerary.day", params: { day: { kind: "index", index: 2 } } } };
    expect(MacroNode.parse(node).attrs.params).toEqual({ day: { kind: "index", index: 2 } });
  });

  it("binds a page to a trip and to nothing else", () => {
    const tripId = crypto.randomUUID();
    expect(PageContext.parse({ tripId })).toEqual({ tripId });
  });

  // A page row written before SPEC §18 carries `dayRef` in its `context` jsonb.
  // `PageContext` is a plain (non-strict) object, so those rows still parse and
  // the dead key is dropped on the way through — which is why removing the
  // field needs no migration and no backfill.
  it("drops a pre-§18 page's day binding instead of rejecting the row", () => {
    const tripId = crypto.randomUUID();
    expect(PageContext.parse({ tripId, dayRef: { kind: "index", index: 0 } })).toEqual({ tripId });
  });

  it("validates a full Page row", () => {
    const page = {
      id: crypto.randomUUID(), tripId: crypto.randomUUID(), title: "Overview",
      context: { tripId: crypto.randomUUID() },
      content: { type: "doc", content: [] },
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), actorId: "user-1",
    };
    expect(Page.parse(page).title).toBe("Overview");
  });

  it("CreatePageInput requires title + context, not id/timestamps", () => {
    const ok = CreatePageInput.safeParse({ title: "X", context: { tripId: crypto.randomUUID() }, content: { type: "doc", content: [] } });
    expect(ok.success).toBe(true);
  });

  // The stale-save guard (CodeRabbit, PR #222) is optional in both shapes, so
  // every caller that predates it (the assistant, `/api/v1`, the seeders)
  // parses exactly as before. Asserted on the OUTPUT, not on `success`: an
  // unknown key is stripped rather than refused, so a schema without the field
  // "accepts" it and silently throws it away.
  it("carries an optional expectedUpdatedAt on an edit and on the PATCH body", () => {
    const tripId = crypto.randomUUID();
    const pageId = crypto.randomUUID();
    const at = "2026-09-24 10:00:00.123+00";
    const edit = { type: "EditPage", tripId, pageId, title: "X" } as const;
    expect(PageCommand.parse({ ...edit, expectedUpdatedAt: at })).toEqual({ ...edit, expectedUpdatedAt: at });
    expect(PageCommand.parse(edit)).toEqual(edit);
    expect(UpdatePageInput.parse({ title: "X", expectedUpdatedAt: at })).toEqual({ title: "X", expectedUpdatedAt: at });
    expect(UpdatePageInput.parse({ title: "X" })).toEqual({ title: "X" });
  });

  // It is echoed back from `Page.updatedAt`, which is Postgres's own text and
  // not ISO, but it must be a time, because the server compares it as one.
  it("refuses an expectedUpdatedAt that is not a time", () => {
    expect(UpdatePageInput.safeParse({ title: "X", expectedUpdatedAt: "yesterday-ish" }).success).toBe(false);
  });
});

// ADR-039's `dates` dimension. It is the one filter whose value can be
// well-formed and still impossible, so the schema has to know the calendar and
// not just the shape.
describe("DateRangeRef", () => {
  it("accepts a real range and a single date", () => {
    expect(DateRangeRef.safeParse({ from: "2027-06-01", through: "2027-06-04" }).success).toBe(true);
    // A single date is `from === through`, which is what lets one control shape
    // express "All · a single date · a range".
    expect(DateRangeRef.safeParse({ from: "2027-06-01", through: "2027-06-01" }).success).toBe(true);
  });

  it("refuses a date that is well-formed and does not exist", () => {
    // `YYYY-MM-DD` alone let these through, and a filter bound to a date that
    // cannot happen matches nothing forever while looking perfectly valid in
    // the document (CodeRabbit, PR 141).
    for (const bad of ["2027-02-30", "2027-13-01", "2027-00-10", "2027-04-31", "2027-06-00"]) {
      expect(DateRangeRef.safeParse({ from: bad, through: bad }).success, bad).toBe(false);
    }
  });

  it("knows which February has a 29th", () => {
    // The case a hand-written month-length table gets wrong. 2028 is a leap
    // year; 2027 is not, and 2100 is not either despite being divisible by 4.
    expect(DateRangeRef.safeParse({ from: "2028-02-29", through: "2028-02-29" }).success).toBe(true);
    expect(DateRangeRef.safeParse({ from: "2027-02-29", through: "2027-02-29" }).success).toBe(false);
    expect(DateRangeRef.safeParse({ from: "2100-02-29", through: "2100-02-29" }).success).toBe(false);
  });

  it("still refuses the wrong shape, and a reversed range", () => {
    expect(DateRangeRef.safeParse({ from: "2027-6-1", through: "2027-06-04" }).success).toBe(false);
    expect(DateRangeRef.safeParse({ from: "2027-06-01" }).success).toBe(false);
    // Refused rather than silently swapped: a reversed range is a mistake
    // somebody made, and quietly reinterpreting it is how a widget shows a
    // confident wrong answer.
    expect(DateRangeRef.safeParse({ from: "2027-06-04", through: "2027-06-01" }).success).toBe(false);
  });
});
