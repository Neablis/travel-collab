import { describe, expect, it } from "vitest";
import { playbooksReaderFor, playbooksRoute } from "./playbooksReader";

// Which copy `proxy.ts` sends a request to. A wrong `cached` would serve a
// signed-in reader the signed-out page (no Saved, no Ask, their private day a
// 404), or one search's URL the plain list; a wrong `live` only costs the cache.
describe("playbooksReaderFor", () => {
  const query = (search: string) => new URLSearchParams(search);

  it("sends a reader with no session and no query to the cached copy", () => {
    expect(playbooksReaderFor(false, query(""))).toBe("cached");
  });

  it("keeps every signed-in reader live, query or not", () => {
    expect(playbooksReaderFor(true, query(""))).toBe("live");
  });

  it.each(["?city=Kyoto", "?page=2", "?from=discover", "?after=abc", "?sort=top"])(
    "keeps %s live: a page reads it",
    (search) => {
      expect(playbooksReaderFor(false, query(search))).toBe("live");
    },
  );

  it("ignores Next's _rsc and a shared link's campaign tags", () => {
    expect(playbooksReaderFor(false, query("?_rsc=1x2y&utm_source=x&utm_campaign=y&fbclid=z&gclid=w"))).toBe("cached");
  });

  it("is live when a read parameter rides with an ignored one", () => {
    expect(playbooksReaderFor(false, query("?utm_source=x&city=Kyoto"))).toBe("live");
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
