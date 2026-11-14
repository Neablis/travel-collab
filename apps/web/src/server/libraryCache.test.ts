import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const revalidateTag = vi.fn();
// Records the key each read is cached under, and reads through.
const unstable_cache = vi.fn((read: () => Promise<unknown>, _keyParts: string[], _options: unknown) => read);
vi.mock("next/cache", () => ({ revalidateTag, unstable_cache }));

const {
  cacheTagHeader,
  invalidateAuthor,
  invalidateDayRead,
  invalidateDiscoverRank,
  DISCOVER_RANK_TAG,
  invalidatePublicDay,
  invalidatePublicDays,
  libraryCached,
} = await import("./libraryCache");

const DAY = "aa000000-0000-4000-8000-000000000001";
const OWNER = "dev-alice";
const TAGS = [`day:${DAY}`, `author:${OWNER}`, "library"];

// ADR-063. What an unpublish, a delete or an operator's hide owes the cache:
// the day, its author and every list, gone now — not served stale once more.
describe("invalidatePublicDay", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    revalidateTag.mockReset();
  });

  it("expires the day, its author and the library in the data cache, at once", async () => {
    await invalidatePublicDay(DAY, OWNER);

    expect(revalidateTag.mock.calls).toEqual(TAGS.map((tag) => [tag, { expire: 0 }]));
  });

  it("never fails the write it follows: a refused revalidateTag is one log line", async () => {
    revalidateTag.mockImplementationOnce(() => {
      throw new Error("static generation store missing");
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(invalidatePublicDay(DAY, OWNER)).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledOnce();
    expect(JSON.stringify(log.mock.calls[0])).toContain("static generation store missing");
  });

  it("touches nothing outside a production build, where nothing was cached", async () => {
    vi.stubEnv("NODE_ENV", "test");
    await invalidatePublicDay(DAY, OWNER);

    expect(revalidateTag).not.toHaveBeenCalled();
  });
});

describe("the narrower clears", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    revalidateTag.mockReset();
  });

  // An add: the day's count and its author's, and no list.
  it("an add clears the day and its author, never the library", async () => {
    await invalidateDayRead(DAY, OWNER);

    const twoTags = [`day:${DAY}`, `author:${OWNER}`];
    expect(revalidateTag.mock.calls).toEqual(twoTags.map((tag) => [tag, { expire: 0 }]));
  });

  // ADR-061 decision 4: a name is on the author's numbers and in every list.
  it("a name change clears the author and the library", async () => {
    await invalidateAuthor(OWNER);

    expect(revalidateTag.mock.calls.map(([tag]) => tag)).toEqual([`author:${OWNER}`, "library"]);
  });

  // The hourly rank rewrite moves only the order, never a day's content.
  it("a rank rewrite clears the discover-rank tag and nothing else", async () => {
    await invalidateDiscoverRank();

    expect(DISCOVER_RANK_TAG).toBe("discover-rank");
    expect(revalidateTag.mock.calls).toEqual([["discover-rank", { expire: 0 }]]);
  });

  it("a rewrite of many days clears each tag once", async () => {
    await invalidatePublicDays([
      { savedDayId: "d1", ownerId: OWNER },
      { savedDayId: "d2", ownerId: OWNER },
    ]);

    const tags = ["day:d1", `author:${OWNER}`, "day:d2", "library"];
    expect(revalidateTag.mock.calls.map(([tag]) => tag)).toEqual(tags);
  });
});

describe("libraryCached", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    unstable_cache.mockClear();
  });

  // A deploy that changes a cached shape must not read the last one's JSON.
  it("keys every entry by the deployment that wrote it", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const keyFor = async () => {
      await libraryCached(["places"], ["library"], async () => []);
      return unstable_cache.mock.lastCall![1];
    };

    vi.stubEnv("VERCEL_DEPLOYMENT_ID", "dpl_one");
    const one = await keyFor();
    vi.stubEnv("VERCEL_DEPLOYMENT_ID", "dpl_two");
    const two = await keyFor();

    expect(one).toContain("dpl_one");
    expect(two).toContain("dpl_two");
    expect(two).not.toEqual(one);
  });
});

describe("cacheTagHeader", () => {
  it("lists the tags for Vercel, leaving off any it would split or refuse", () => {
    expect(cacheTagHeader(`day:${DAY}`, "library")).toEqual({ "Vercel-Cache-Tag": `day:${DAY},library` });
    // A segment someone typed: a comma would make two tags of one, and Vercel
    // takes 256 bytes at most.
    expect(cacheTagHeader("author:a,library", `author:${"x".repeat(300)}`, "library")).toEqual({
      "Vercel-Cache-Tag": "library",
    });
    expect(cacheTagHeader("author:a,b")).toEqual({});
  });
});
