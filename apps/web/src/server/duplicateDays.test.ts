// M53 part D: the duplicate guard's pure half — what counts as a copy, and
// what counts as a fork. No database here: the published list is handed in,
// so these pin the comparison itself, and the integration lane pins the
// query that feeds it.
import { describe, expect, it } from "vitest";
import {
  dayPageDescription,
  dayPageTitle,
  findDuplicateDays,
  pageIdentity,
  type GuardStop,
  type PageDay,
} from "./duplicateDays";

const stop = (title: string, start: string | null, city: string): GuardStop => ({
  title,
  timeWindow: start === null ? null : { start },
  kind: "planned",
  location: { city },
  dayIndex: 0,
});

const day = (
  savedDayId: string,
  overrides: Partial<PageDay> & { name: string },
): PageDay => ({
  savedDayId,
  cities: ["Bologna"],
  summary: "Eat your way through Italy's food capital.",
  stops: [stop("Breakfast crawl at Mercato di Mezzo", "09:00", "Bologna")],
  ...overrides,
});

const published = day("published-1", { name: "3 days in Bologna: tortellini, mortadella & market mornings" });

describe("dayPageTitle", () => {
  it("names the day and its first city, and the bare name when there is no city", () => {
    expect(dayPageTitle("3 days in Bologna", ["Bologna"])).toBe("3 days in Bologna · Bologna");
    expect(dayPageTitle("3 days in Bologna", [])).toBe("3 days in Bologna");
  });
});

describe("dayPageDescription", () => {
  it("is the summary when there is one, and the arc sentence when there is none", () => {
    expect(dayPageDescription("Eat your way through.", ["Bologna"], [])).toBe("Eat your way through.");
    expect(dayPageDescription(null, ["Bologna"], [stop("Breakfast crawl", "09:00", "Bologna")])).toBe(
      "A day in Bologna: Breakfast crawl, planned by someone who lived it. Borrow it for your trip.",
    );
  });

  it("is null when the page would fall through to the facts line", () => {
    expect(dayPageDescription(null, ["Bologna"], [])).toBeNull();
    expect(dayPageDescription("   ", ["Bologna"], [])).toBeNull();
  });
});

describe("findDuplicateDays", () => {
  it("refuses the same title AND the same description under a different id", () => {
    const collisions = findDuplicateDays(
      [day("incoming-1", { name: published.name })],
      [published],
    );
    expect(collisions).toEqual([
      {
        incomingId: "incoming-1",
        incomingName: published.name,
        existingId: "published-1",
        title: "3 days in Bologna: tortellini, mortadella & market mornings · Bologna",
        description: "Eat your way through Italy's food capital.",
      },
    ]);
  });

  it("refuses despite case and whitespace differences — the same words, re-typed", () => {
    const collisions = findDuplicateDays(
      [day("incoming-1", { name: "  3 DAYS in bologna: tortellini, mortadella & market mornings  ", summary: "  eat your way through Italy's food capital. " })],
      [published],
    );
    expect(collisions).toHaveLength(1);
  });

  it("lets a fork through when the title was edited", () => {
    expect(
      findDuplicateDays(
        [day("incoming-1", { name: "3 days in Bologna: pasta, wine & market mornings" })],
        [published],
      ),
    ).toEqual([]);
  });

  it("lets a fork through when the description was edited — title + city alone is not the guard", () => {
    expect(
      findDuplicateDays(
        [day("incoming-1", { name: published.name, summary: "A different take on Bologna's food capital." })],
        [published],
      ),
    ).toEqual([]);
  });

  it("lets the same name and summary through in another city — another page, not a copy", () => {
    expect(
      findDuplicateDays(
        [day("incoming-1", { name: published.name, cities: ["Modena"], stops: [stop("Breakfast crawl at Mercato di Mezzo", "09:00", "Modena")] })],
        [published],
      ),
    ).toEqual([]);
  });

  it("exempts the same id: a re-import updating its own day is not a duplicate", () => {
    expect(
      findDuplicateDays(
        [day("published-1", { name: published.name })],
        [published],
      ),
    ).toEqual([]);
  });

  it("refuses a summary-less copy whose arc sentence matches", () => {
    const arcPublished = day("published-1", { name: "A day in Bologna", summary: null });
    const arcIncoming = day("incoming-1", { name: "A day in Bologna", summary: null });
    expect(pageIdentity(arcPublished)).not.toBeNull();
    expect(findDuplicateDays([arcIncoming], [arcPublished])).toHaveLength(1);
  });

  it("never refuses a day with no guardable description", () => {
    const empty = day("incoming-1", { name: published.name, summary: null, stops: [] });
    expect(pageIdentity(empty)).toBeNull();
    expect(findDuplicateDays([empty], [published])).toEqual([]);
  });
});
