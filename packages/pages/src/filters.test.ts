import { describe, expect, it } from "vitest";
import { FilterDimension } from "@tc/contracts";
import { LEGAL_FILTERS, filterInputs, filterParams, paramKeyOf, type WidgetEntity } from "./filters";

const ENTITIES: readonly WidgetEntity[] = ["day", "stop", "city", "trip", "account"];

describe("the legality matrix (ADR-039 decision 3)", () => {
  it("has a row for every entity, and names only real dimensions", () => {
    // A missing row would make `LEGAL_FILTERS[entity]` `undefined` and every
    // subset check against it pass vacuously — the matrix silently permitting
    // everything is the exact failure it exists to prevent.
    for (const entity of ENTITIES) {
      expect(LEGAL_FILTERS[entity], `${entity} has no row`).toBeDefined();
      for (const dimension of LEGAL_FILTERS[entity]) {
        expect(FilterDimension.options, `${entity} names ${dimension}`).toContain(dimension);
      }
    }
  });

  it("keeps `stop`'s row a superset of `day`'s and `city`'s", () => {
    // Load-bearing rather than incidental: `count` is the one primitive the
    // spec gives three entities ("stop / day / city"), and it declares the stop
    // row so that one primitive can count all three. If the day row ever gains
    // a dimension the stop row lacks, `count` would be offering a filter it
    // cannot honour and this fails rather than the picker lying.
    for (const narrower of ["day", "city"] as const) {
      for (const dimension of LEGAL_FILTERS[narrower]) {
        expect(LEGAL_FILTERS.stop, `stop's row is missing ${dimension}, which ${narrower} allows`).toContain(dimension);
      }
    }
  });

  it("gives `trip` and `account` no dimensions at all", () => {
    // ADR-039 decision 6: `attribute` reads one field of one thing. There is no
    // set behind a trip or an account, so there is nothing to narrow — and an
    // empty row is a statement, not an oversight.
    expect(LEGAL_FILTERS.trip).toEqual([]);
    expect(LEGAL_FILTERS.account).toEqual([]);
  });

  it("refuses `person` on days and cities", () => {
    // A day has no person and cannot acquire one: `person` arrives on the STOP
    // (M13 `add-stop-who` / M19 link 3), and "which days someone is on" is a
    // question about their stops. Pinned because the temptation when the field
    // lands will be to add the row rather than the primitive.
    expect(LEGAL_FILTERS.day).not.toContain("person");
    expect(LEGAL_FILTERS.city).not.toContain("person");
    expect(LEGAL_FILTERS.stop).toContain("person");
  });
});

describe("filterParams / filterInputs", () => {
  it("names every param after its own dimension", () => {
    for (const dimension of FilterDimension.options) {
      expect(paramKeyOf(dimension)).toBe(dimension);
    }
  });

  it("makes every dimension optional, because absent means every member", () => {
    // ADR-039 decision 2 in one assertion: `{}` is a complete, valid binding for
    // a widget declaring all six. A required dimension would make "All" a state
    // the widget could not be in.
    const schema = filterParams(["day", "city", "tag", "kind", "person", "dates"]);
    expect(schema.safeParse({}).success).toBe(true);
  });

  it("validates each dimension's value against its contract shape", () => {
    const schema = filterParams(["day", "kind", "dates"]);
    expect(schema.safeParse({ kind: "booked" }).success).toBe(true);
    expect(schema.safeParse({ kind: "reserved" }).success, "an invented kind").toBe(false);
    expect(schema.safeParse({ day: { kind: "index", index: 2 } }).success).toBe(true);
    expect(schema.safeParse({ day: 2 }).success, "a bare number is not a DayRef").toBe(false);
    expect(schema.safeParse({ dates: { from: "2027-06-01", through: "2027-06-04" } }).success).toBe(true);
    expect(
      schema.safeParse({ dates: { from: "2027-06-04", through: "2027-06-01" } }).success,
      "a reversed range is refused rather than swapped",
    ).toBe(false);
  });

  it("strips a dimension the primitive did not declare", () => {
    // The other half of legality: a widget that declares `day` only must not
    // quietly carry a `kind` its resolver never reads. `.strip()` drops it, and
    // `registry.test.ts` asserts the same thing registry-wide.
    const parsed = filterParams(["day"]).parse({ day: { kind: "index", index: 0 }, kind: "booked" });
    expect(parsed).not.toHaveProperty("kind");
    expect(parsed).toHaveProperty("day");
  });

  it("keeps the params a primitive declares outside the vocabulary", () => {
    // `count`'s `of`, and later `attribute`'s `field`: chosen at insert time,
    // not dimensions of a selection. They must survive the parse and get no
    // control.
    const schema = filterParams(["day"], { of: FilterDimension.optional() });
    expect(schema.parse({ of: "city" })).toHaveProperty("of", "city");
    expect(filterInputs(["day"]).map((i) => i.name)).toEqual(["day"]);
  });

  it("derives one control per dimension, in declaration order", () => {
    // SPEC §5: the chrome row, the phone's bind sheet and the insert step read
    // ONE declaration, so they cannot offer different things.
    expect(filterInputs(["day", "tag", "kind"])).toEqual([
      { name: "day", type: "day", label: "Day" },
      // The one place the two vocabularies differ in spelling: the dimension is
      // `tag`, the input type is `tags` (named for the control, and older).
      { name: "tag", type: "tags", label: "Tags" },
      { name: "kind", type: "kind", label: "Kind" },
    ]);
  });
});
