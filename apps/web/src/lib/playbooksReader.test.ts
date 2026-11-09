import { describe, expect, it } from "vitest";
import { isInternalPlaybooksPath, playbooksReaderFor, playbooksRoute } from "./playbooksReader";

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

  // The link off a place, tag or length page to a day: its back link is
  // Discover either way, so it reads the cache (2026-11-06).
  it("caches a bare from=playbooks, which asks for the default back link", () => {
    expect(playbooksReaderFor(false, "/playbooks/city/kyoto", query("?from=playbooks"))).toBe("cached");
    expect(playbooksReaderFor(false, "/playbooks/city/kyoto", query("?from=playbooks&utm_source=x"))).toBe("cached");
  });

  it("keeps from=playbooks live when it names a Discover search to go back to", () => {
    expect(playbooksReaderFor(false, "/playbooks/city/kyoto", query("?from=playbooks&discover=scope%3Dyours"))).toBe("live");
  });

  it.each(["?from=board", "?from=day&day=x", "?from=profile&profile=y"])("keeps %s live", (search) => {
    expect(playbooksReaderFor(false, "/playbooks/profile/u1", query(search))).toBe("live");
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

  // Production, 2026-11-09: a request for an internal path was prefixed again,
  // `/playbooks/cached/cached/…`, and every such URL a crawler followed was a
  // new one.
  it.each(["/playbooks/cached", "/playbooks/live", "/playbooks/cached/", "/playbooks/live/day/a-b", "/playbooks/cached/cached"])(
    "does not prefix a path already under a copy: %s",
    (path) => {
      expect(playbooksRoute(path, "cached")).toBeNull();
      expect(playbooksRoute(path, "live")).toBeNull();
    },
  );
});

describe("isInternalPlaybooksPath", () => {
  it.each(["/playbooks/cached", "/playbooks/live/", "/playbooks/cached/day/a-b", "/playbooks/live/live"])("names %s", (path) => {
    expect(isInternalPlaybooksPath(path)).toBe(true);
  });

  it.each(["/playbooks", "/playbooks/day/a-b", "/playbooks/livery", "/playbooks/city/live", "/trips/playbooks/live"])(
    "does not name %s",
    (path) => {
      expect(isInternalPlaybooksPath(path)).toBe(false);
    },
  );
});
