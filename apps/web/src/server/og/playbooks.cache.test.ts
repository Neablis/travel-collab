import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Answers from the cache without reading: a lookup that reached the database
// here would throw on the empty `db` below, which is the point. What is pinned
// is the key and the tags each card is cached under, because the tags are how
// a publish, an unpublish, a moderation or a renamed author takes a card out
// (`libraryCache.ts`). 2026-11-17: the cards were read on every unfurl, which
// was a database read per unfurl.
const unstable_cache = vi.fn(
  (_read: () => Promise<unknown>, _keyParts: string[], _options: { tags: string[] }) => () =>
    Promise.resolve({ kind: "generic" }),
);
vi.mock("next/cache", () => ({ unstable_cache, revalidateTag: vi.fn() }));
vi.mock("../db/client", () => ({ db: {} }));

const { cityCardFor, countryCardFor, dayCardFor, profileCardFor } = await import("./playbooks");

const DAY = "aa000000-0000-4000-8000-000000000001";
const AUTHOR = "dev-alice";

/** The key parts after the cache's own scope, and the tags, of the one cached read. */
function cachedUnder(): { key: string[]; tags: string[] } {
  expect(unstable_cache).toHaveBeenCalledOnce();
  const [, keyParts, options] = unstable_cache.mock.calls[0]!;
  return { key: keyParts.slice(-2), tags: options.tags };
}

describe("the Playbooks preview cards are cached like the pages they preview", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    unstable_cache.mockClear();
  });

  it("caches a day's card under the day and the library, so an unpublish clears it", async () => {
    await dayCardFor(DAY);
    expect(cachedUnder()).toEqual({ key: ["og-day", DAY], tags: [`day:${DAY}`, "library"] });
  });

  it("caches a profile card under its author and the library, so a rename clears it", async () => {
    await profileCardFor(AUTHOR);
    expect(cachedUnder()).toEqual({ key: ["og-profile", AUTHOR], tags: [`author:${AUTHOR}`, "library"] });
  });

  it("caches a city's count under the library", async () => {
    await cityCardFor("Kyoto");
    expect(cachedUnder()).toEqual({ key: ["og-city", "Kyoto"], tags: ["library"] });
  });

  it("caches a country's count under its code and the library", async () => {
    await countryCardFor("jp");
    expect(cachedUnder()).toEqual({ key: ["og-country", "JP"], tags: ["library"] });
  });

  it("answers a junk city before the cache, so a typed URL cannot fill it", async () => {
    await expect(cityCardFor("x".repeat(500))).resolves.toEqual({ kind: "generic" });
    expect(unstable_cache).not.toHaveBeenCalled();
  });
});
