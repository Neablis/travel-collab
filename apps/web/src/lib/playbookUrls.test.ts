import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { witness } from "../test-support/witness";
import {
  cityPath,
  countryPath,
  countrySlug,
  dayPath,
  daySegment,
  MIN_INDEXED_PLACE_DAYS,
  parseDaySegment,
  placeIndexable,
  placePagePath,
  placePath,
  slugify,
} from "./playbookUrls";

const ID = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";

describe("slugify", () => {
  it("lowercases, strips accents and joins words with one hyphen", () => {
    expect(slugify("A Slow Day in Gion")).toBe("a-slow-day-in-gion");
    expect(slugify("São Paulo — café crawl!")).toBe("sao-paulo-cafe-crawl");
    expect(slugify("  --Kyoto--  ")).toBe("kyoto");
  });

  it("spells out the Latin letters that have no decomposition, rather than dropping them", () => {
    // A city's URL has no redirect behind it, so a letter dropped now is a 404
    // the day the rule is corrected (review of #299).
    expect(slugify("Wrocław")).toBe("wroclaw");
    expect(slugify("Łódź")).toBe("lodz");
    expect(slugify("Tromsø")).toBe("tromso");
    expect(slugify("Đà Nẵng")).toBe("da-nang");
    expect(slugify("Straße")).toBe("strasse");
    expect(slugify("Þórsmörk")).toBe("thorsmork");
    expect(slugify("Ærø")).toBe("aero");
    expect(slugify("Œuvre")).toBe("oeuvre");
    expect(slugify("Kırklareli")).toBe("kirklareli");
  });

  it("is empty for a name with no Latin letters or digits", () => {
    expect(slugify("京都の一日")).toBe("");
    expect(slugify("🍜🍣")).toBe("");
    expect(slugify("")).toBe("");
  });

  it("stops at 60 characters without a trailing hyphen", () => {
    const slug = slugify(`${"word ".repeat(30)}`);
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("day URLs", () => {
  it("puts the slug before the id", () => {
    expect(daySegment({ savedDayId: ID, name: "A Slow Day in Gion" })).toBe(`a-slow-day-in-gion-${ID}`);
    expect(dayPath({ savedDayId: ID, name: "A Slow Day in Gion" })).toBe(`/playbooks/day/a-slow-day-in-gion-${ID}`);
  });

  it("is the bare id when the name has no slug", () => {
    expect(daySegment({ savedDayId: ID, name: "京都の一日" })).toBe(ID);
  });

  it("reads the id off the end of any segment", () => {
    expect(parseDaySegment(`a-slow-day-in-gion-${ID}`)).toEqual({ id: ID, slug: "a-slow-day-in-gion" });
    expect(parseDaySegment(ID)).toEqual({ id: ID, slug: "" });
    expect(parseDaySegment(ID.toUpperCase())).toEqual({ id: ID, slug: "" });
  });

  it("finds no id in anything else", () => {
    expect(parseDaySegment("not-a-day").id).toBeNull();
    expect(parseDaySegment("").id).toBeNull();
  });

  it("recovers the id when the name itself ends in a uuid", () => {
    const other = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const segment = daySegment({ savedDayId: ID, name: `Copy of ${other}` });
    expect(parseDaySegment(segment).id).toBe(ID);
    expect(parseDaySegment(daySegment({ savedDayId: ID, name: other })).id).toBe(ID);
  });

  // A claim about ALL names: whatever a day is called, the segment built from
  // it gives the same day back, and its slug is the one slugify derived.
  it("parses back the id from any segment it builds — for any name", () => {
    const w = witness("daySegment/parseDaySegment round trip");
    fc.assert(
      fc.property(fc.uuid(), fc.string({ unit: "binary" }), (savedDayId, name) => {
        w.tick();
        const parsed = parseDaySegment(daySegment({ savedDayId, name }));
        expect(parsed.id).toBe(savedDayId.toLowerCase());
        expect(parsed.slug).toBe(slugify(name));
      }),
    );
    w.atLeast(50);
  });
});

describe("place URLs", () => {
  it("slugs a city and a country's English name", () => {
    expect(cityPath("São Paulo")).toBe("/playbooks/city/sao-paulo");
    expect(countryPath("JP")).toBe("/playbooks/country/japan");
  });

  // `countryName` hands back the code itself for one it cannot map ("??"
  // throws inside `Intl.DisplayNames`, "XX" is returned as is) — a code is not
  // a name, and slugging it would mint `/playbooks/country/xx`.
  it("has no path for a place with no slug", () => {
    expect(cityPath("京都")).toBeNull();
    expect(countrySlug("??")).toBeNull();
    expect(countrySlug("XX")).toBeNull();
    expect(countryPath("??")).toBeNull();
  });

  it("puts a city or country page under its kind", () => {
    expect(placePath({ kind: "city", slug: "kyoto" })).toBe("/playbooks/city/kyoto");
    expect(placePath({ kind: "country", slug: "japan" })).toBe("/playbooks/country/japan");
  });

  it("leaves page one bare and numbers the rest", () => {
    expect(placePagePath("/playbooks/city/kyoto", 1)).toBe("/playbooks/city/kyoto");
    expect(placePagePath("/playbooks/city/kyoto", 3)).toBe("/playbooks/city/kyoto?page=3");
  });

  it("indexes a place from the threshold up, not below it", () => {
    expect(placeIndexable({ days: MIN_INDEXED_PLACE_DAYS - 1 })).toBe(false);
    expect(placeIndexable({ days: MIN_INDEXED_PLACE_DAYS })).toBe(true);
  });
});
