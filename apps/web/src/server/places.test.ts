// Unit tests for the countries memo in front of `searchPlaces`'s aggregate.
//
// The database is mocked: these tests prove the memo behaviour (one aggregate
// run per window, `forgetCountrySearches` clearing it, callers getting their
// own rows), not the SQL itself. The city half is mocked the same way, and
// the two aggregates are told apart by the query text: the city aggregate
// groups `as city`, the countries aggregate groups `as code`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forgetCitySearches } from "./cities";
import { forgetCountrySearches, searchPlaces } from "./places";

vi.mock("@/server/db/client", () => ({
  db: {
    execute: vi.fn(),
  },
}));

import { db } from "@/server/db/client";

const mockExecute = vi.mocked(db.execute);

/** The raw SQL text of a drizzle `sql` template, recursing into nested fragments. */
function sqlText(query: unknown): string {
  const chunks = (query as { queryChunks: unknown[] }).queryChunks ?? [];
  return chunks
    .map((c) => {
      if (typeof c === "string") return c;
      if (typeof c !== "object" || c === null) return "";
      if ("value" in c && Array.isArray((c as { value: unknown }).value))
        return ((c as { value: unknown[] }).value as unknown[]).join("");
      if ("queryChunks" in c) return sqlText(c);
      return "";
    })
    .join("");
}

/** How many times the countries aggregate (not the city one) has run so far. */
function countryRuns(): number {
  return mockExecute.mock.calls.filter(([query]) => sqlText(query).includes("as code")).length;
}

beforeEach(() => {
  vi.clearAllMocks();
  forgetCitySearches();
  forgetCountrySearches();
  mockExecute.mockImplementation((query: unknown) => {
    // The mock answers both aggregates regardless of the query; the city
    // aggregate's rows are returned verbatim, so a city name here matches
    // every prefix — the tests assert on run counts, not on filtering.
    // `db.execute` returns drizzle's thenable `PgRaw`, not a promise, so the
    // resolved value is cast across it; at runtime callers simply await it.
    const rows = sqlText(query).includes("as code")
      ? [{ code: "JP", days: 3 }]
      : [{ city: "Jakarta", days: 2 }];
    return Promise.resolve({ rows }) as unknown as ReturnType<typeof db.execute>;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("searchPlaces countries memo", () => {
  it("runs the countries aggregate once for two searches inside the window", async () => {
    const first = await searchPlaces("Ja");
    expect(first).toContainEqual({ kind: "country", countryCode: "JP", name: "Japan", days: 3, hasPlaybooks: true });
    expect(countryRuns()).toBe(1);

    // A different query, so the city half re-runs — but the countries half
    // must not: one aggregate run total across both searches.
    const second = await searchPlaces("Jap");
    expect(second).toContainEqual({ kind: "country", countryCode: "JP", name: "Japan", days: 3, hasPlaybooks: true });
    expect(countryRuns()).toBe(1);
    expect(mockExecute).toHaveBeenCalledTimes(3);
  });

  it("re-runs the countries aggregate after forgetCountrySearches", async () => {
    await searchPlaces("Ja");
    expect(countryRuns()).toBe(1);

    forgetCountrySearches();
    // Same query, so the city half stays memoised — the one new run is the
    // countries aggregate.
    await searchPlaces("Ja");
    expect(countryRuns()).toBe(2);
    expect(mockExecute).toHaveBeenCalledTimes(3);
  });

  it("runs the countries aggregate again once the window expires", async () => {
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValue(1_000_000);
    await searchPlaces("Ja");
    expect(countryRuns()).toBe(1);

    nowSpy.mockReturnValue(1_000_000 + 31_000);
    await searchPlaces("Ja");
    expect(countryRuns()).toBe(2);
  });

  it("hands each caller its own country rows", async () => {
    const first = await searchPlaces("Ja");
    const country = first.find((p) => p.kind === "country");
    expect(country).toBeDefined();
    (country as { days: number }).days = 999;

    const second = await searchPlaces("Ja");
    expect(second).toContainEqual({ kind: "country", countryCode: "JP", name: "Japan", days: 3, hasPlaybooks: true });
  });
});
