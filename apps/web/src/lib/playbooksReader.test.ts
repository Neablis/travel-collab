import { describe, expect, it } from "vitest";
import { playbooksReaderFor, playbooksRoute } from "./playbooksReader";

// Which copy `proxy.ts` sends a request to. A wrong `cached` would serve a
// signed-in reader the signed-out page (no Saved, no Ask, their private day a
// 404), or one search's URL the plain list; a wrong `live` only costs the cache.
describe("playbooksReaderFor", () => {
  const query = (search: string) => new URLSearchParams(search);

  it("sends a reader with no session and no query to the cached copy", () => {
    expect(playbooksReaderFor(false, "/playbooks", query(""))).toBe("cached");
  });

  it("keeps every signed-in reader live, query or not", () => {
    expect(playbooksReaderFor(true, "/playbooks", query(""))).toBe("live");
  });

  it.each(["?city=Kyoto", "?page=2", "?from=discover", "?after=abc", "?sort=top"])(
    "keeps %s live: a page reads it",
    (search) => {
      expect(playbooksReaderFor(false, "/playbooks", query(search))).toBe("live");
    },
  );

  it("ignores Next's _rsc and a shared link's campaign tags", () => {
    expect(playbooksReaderFor(false, "/playbooks", query("?_rsc=1x2y&utm_source=x&utm_campaign=y&fbclid=z&gclid=w"))).toBe("cached");
  });

  // A launch link (ADR-079) is the traffic spike the cached copy exists for.
  it("ignores a launch link's ref", () => {
    expect(playbooksReaderFor(false, "/playbooks", query("?ref=x"))).toBe("cached");
  });

  it("is live when a read parameter rides with an ignored one", () => {
    expect(playbooksReaderFor(false, "/playbooks", query("?utm_source=x&city=Kyoto"))).toBe("live");
  });
});

describe("playbooksReaderFor, on a day", () => {
  const ID = "aa000000-0000-4000-8000-000000000002";
  const reader = (segment: string) => playbooksReaderFor(false, `/playbooks/day/${segment}`, new URLSearchParams());

  it("caches a segment that can be canonical: a slug, then the lower-case id", () => {
    expect(reader(`tokyo-to-hakone-slowly-${ID}`)).toBe("cached");
  });

  // Each of these is a 308, whose cache-filling render sends `Location` twice
  // under `next start` (the note in playbooksReader.ts).
  it.each([
    ["a bare id", ID],
    ["an upper-cased id", `tokyo-${ID.toUpperCase()}`],
    ["a doubled hyphen", `tokyo--hakone-${ID}`],
    ["an upper-cased slug", `Tokyo-${ID}`],
  ])("answers %s live", (_case, segment) => {
    expect(reader(segment)).toBe("live");
  });
});

describe("playbooksRoute", () => {
  it.each([
    ["/playbooks", "/playbooks/cached"],
    ["/playbooks/", "/playbooks/cached/"],
    ["/playbooks/day/a-b", "/playbooks/cached/day/a-b"],
    ["/playbooks/city/kyoto/food", "/playbooks/cached/city/kyoto/food"],
  ])("puts the copy after /playbooks: %s", (path, route) => {
    expect(playbooksRoute(path, "cached")).toBe(route);
  });

  it("leaves every other path alone", () => {
    expect(playbooksRoute("/playbooksx", "live")).toBeNull();
    expect(playbooksRoute("/trips/playbooks", "live")).toBeNull();
  });
});
