import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const revalidateTag = vi.fn();
const dangerouslyDeleteByTag = vi.fn(async (..._a: unknown[]) => {});
vi.mock("next/cache", () => ({ revalidateTag, unstable_cache: vi.fn() }));
vi.mock("@vercel/functions", () => ({ dangerouslyDeleteByTag }));

const { PURGE_TIMEOUT_MS, cacheTagHeader, invalidateDayRead, invalidatePublicDay } = await import("./libraryCache");

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
    dangerouslyDeleteByTag.mockReset();
  });

  it("expires the day, its author and the library in the data cache, at once", async () => {
    await invalidatePublicDay(DAY, OWNER);

    expect(revalidateTag.mock.calls).toEqual(TAGS.map((tag) => [tag, { expire: 0 }]));
  });

  it("deletes the same tags from the CDN on Vercel, and only there", async () => {
    vi.stubEnv("VERCEL", "");
    await invalidatePublicDay(DAY, OWNER);
    expect(dangerouslyDeleteByTag).not.toHaveBeenCalled();

    vi.stubEnv("VERCEL", "1");
    await invalidatePublicDay(DAY, OWNER);
    expect(dangerouslyDeleteByTag).toHaveBeenCalledExactlyOnceWith(TAGS);
  });

  it("never fails the write it follows: a refused purge is one log line", async () => {
    vi.stubEnv("VERCEL", "1");
    dangerouslyDeleteByTag.mockRejectedValueOnce(new Error("purge api down"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(invalidatePublicDay(DAY, OWNER)).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledOnce();
    expect(JSON.stringify(log.mock.calls[0])).toContain("purge api down");
  });

  it("gives up on a purge that never answers, so the write it follows still returns", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.useFakeTimers();
    dangerouslyDeleteByTag.mockImplementationOnce(() => new Promise(() => {}));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    let settled = false;

    const done = invalidatePublicDay(DAY, OWNER).then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(PURGE_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await done;

    expect(settled).toBe(true);
    expect(JSON.stringify(log.mock.calls[0])).toContain(`no answer in ${PURGE_TIMEOUT_MS}ms`);
    vi.useRealTimers();
  });

  it("touches nothing outside a production build, where nothing was cached", async () => {
    vi.stubEnv("NODE_ENV", "test");
    await invalidatePublicDay(DAY, OWNER);

    expect(revalidateTag).not.toHaveBeenCalled();
  });
});

describe("invalidateDayRead", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    revalidateTag.mockReset();
    dangerouslyDeleteByTag.mockReset();
  });

  // An add: the day's count and its author's, and no list.
  it("clears the day and its author, never the library", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    await invalidateDayRead(DAY, OWNER);

    const twoTags = [`day:${DAY}`, `author:${OWNER}`];
    expect(revalidateTag.mock.calls).toEqual(twoTags.map((tag) => [tag, { expire: 0 }]));
    expect(dangerouslyDeleteByTag).toHaveBeenCalledExactlyOnceWith(twoTags);
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
