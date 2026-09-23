import { describe, expect, it } from "vitest";
import { DISCOVER_URL_DEFAULTS, discoverQueryString, parseDiscoverUrl } from "./discoverUrl";

const fromQuery = (query: string) =>
  parseDiscoverUrl(
    Object.fromEntries(
      [...new URLSearchParams(query).keys()].map((key) => [key, new URLSearchParams(query).getAll(key)]),
    ),
  );

describe("Discover's state as a URL", () => {
  // The round trip is the property the page relies on: what the screen writes
  // after a change is exactly what a reload of that URL seeds it with.
  it("reads back what it writes", () => {
    const state = {
      cities: ["Kyoto", "Mexico City"],
      countries: ["MX", "JP"],
      scope: "yours" as const,
      sort: "highest-rated" as const,
      length: "two-three" as const,
      rating: "4.5" as const,
    };
    expect(fromQuery(discoverQueryString(state))).toEqual(state);
  });

  it("writes nothing for an untouched Discover", () => {
    expect(discoverQueryString(DISCOVER_URL_DEFAULTS)).toBe("");
  });

  // A hand-edited or stale URL falls back per field rather than failing the
  // page — and a country code is normalised to the stored upper case.
  it("drops what it cannot read and keeps the rest", () => {
    expect(fromQuery("sort=best&rating=5&country=jp&country=Japan&city=Kyoto")).toEqual({
      ...DISCOVER_URL_DEFAULTS,
      cities: ["Kyoto"],
      countries: ["JP"],
    });
  });
});
