import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "./db/client";
import { savedDays } from "./db/schema";
import type { DiscoverInput } from "./playbooks";
import { newSavedDayRow } from "./savedDays";

// Next's data cache, as far as these reads rely on it: one entry per key,
// kept as JSON, and a read that throws stores nothing. It never expires on its
// own, so the day-old entry below is served as long as anything is — which is
// what Next does with an entry whose refresh keeps failing.
const cache = vi.hoisted(() => ({
  entries: new Map<string, { json: string; tags: string[] }>(),
  reads: new Map<string, number>(),
}));
vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  unstable_cache:
    (read: () => Promise<unknown>, keyParts: string[], options: { tags: string[] }) => async () => {
      const key = keyParts.join(",");
      const hit = cache.entries.get(key);
      if (hit !== undefined) return JSON.parse(hit.json);
      cache.reads.set(key, (cache.reads.get(key) ?? 0) + 1);
      const value = await read();
      cache.entries.set(key, { json: JSON.stringify(value), tags: options.tags });
      return value;
    },
}));
// The live read the cache must step aside for, counted.
vi.mock("./sharedDayView", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./sharedDayView")>();
  return { ...actual, sharedDayView: vi.fn(actual.sharedDayView) };
});

// The snapshot's read, so one test can hand back a library too big to cache.
vi.mock("./playbooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./playbooks")>();
  return { ...actual, readLibrarySnapshot: vi.fn(actual.readLibrarySnapshot) };
});

const { sharedDayView } = await import("./sharedDayView");
const { readLibrarySnapshot } = await import("./playbooks");
const { dayPageView, discoverFor, publishedDaysPage } = await import("./publicLibrary");

const RUN = randomUUID().slice(0, 8);
const AUTHOR = `cache-author-${RUN}`;
const READER = `cache-reader-${RUN}`;
const CITY = `Cachetest${RUN}`;
const ids: string[] = [];

// Rows written directly, as `playbooks.places.int.test.ts` does: what is under
// test is which reads go through the cache, not how a day gets published.
async function day(columns: Partial<typeof savedDays.$inferInsert> = {}): Promise<string> {
  const row = newSavedDayRow({
    ownerId: AUTHOR,
    name: `A day in ${CITY}`,
    stops: [],
    sourceTripId: randomUUID(),
    sourceTripName: "Source",
    createdAt: new Date(),
  });
  await db.insert(savedDays).values({ ...row, cities: [CITY], visibility: "public", publishedAt: new Date(), ...columns });
  ids.push(row.id);
  return row.id;
}

/** How many times the cache had to read the entry whose key ends in `parts`. */
const readsOf = (...parts: string[]) =>
  [...cache.reads].filter(([key]) => key.endsWith(parts.join(","))).reduce((n, [, reads]) => n + reads, 0);

beforeEach(() => {
  // `libraryCached` reads live outside a production build.
  vi.stubEnv("NODE_ENV", "production");
  cache.entries.clear();
  cache.reads.clear();
  vi.mocked(sharedDayView).mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

afterAll(async () => {
  await db.delete(savedDays).where(inArray(savedDays.id, ids));
});

describe("the day page's read", () => {
  it("caches a published day by its id, read once for everyone signed out", async () => {
    const id = await day();

    const first = await dayPageView(id, null);
    const second = await dayPageView(id, null);

    expect(second).toEqual(first);
    expect(first?.view.day.savedDayId).toBe(id);
    expect(readsOf("day", id)).toBe(1);
    expect([...cache.entries.values()].map((e) => e.tags)).toContainEqual([`day:${id}`]);
    expect(sharedDayView).not.toHaveBeenCalled();
  });

  it("never caches a miss: a private day and an unknown one are read every time, and are both null", async () => {
    const privateId = await day({ visibility: "private", publishedAt: null });
    const unknownId = randomUUID();

    for (const id of [privateId, unknownId]) {
      expect(await dayPageView(id, null)).toBeNull();
      expect(await dayPageView(id, null)).toBeNull();
      expect(readsOf("day", id)).toBe(2);
    }
    expect([...cache.entries.keys()].filter((key) => key.includes(privateId) || key.includes(unknownId))).toEqual([]);
  });

  it("serves a signed-in reader who did not write it from the cache, as a stranger", async () => {
    const id = await day();
    await dayPageView(id, null);

    const read = await dayPageView(id, READER);

    expect(read?.view).toMatchObject({ isAuthor: false, moderation: null });
    expect(readsOf("day", id)).toBe(1);
    expect(sharedDayView).not.toHaveBeenCalled();
  });

  it("reads live for its author, published or not", async () => {
    const published = await day();
    const kept = await day({ visibility: "private", publishedAt: null });

    const own = await dayPageView(published, AUTHOR);
    const ownPrivate = await dayPageView(kept, AUTHOR);

    expect(own?.view.isAuthor).toBe(true);
    expect(ownPrivate?.view.day.savedDayId).toBe(kept);
    expect(sharedDayView).toHaveBeenCalledWith(published, AUTHOR);
    expect(sharedDayView).toHaveBeenCalledWith(kept, AUTHOR);
    // Somebody else's private day is still nobody's.
    expect(await dayPageView(kept, READER)).toBeNull();
  });

  it("reads a day-old entry live rather than serving it, so a day that left uncleared is gone", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2031-01-01T12:00:00.000Z"));
    const id = await day();
    expect(await dayPageView(id, null)).not.toBeNull();
    // Withdrawn by a path that cleared nothing (a content import, a hand-run UPDATE).
    await db.update(savedDays).set({ visibility: "private", publishedAt: null }).where(eq(savedDays.id, id));

    vi.setSystemTime(new Date("2031-01-02T11:59:59.000Z"));
    expect(await dayPageView(id, null)).not.toBeNull();
    vi.setSystemTime(new Date("2031-01-02T12:00:01.000Z"));
    expect(await dayPageView(id, null)).toBeNull();
  });
});

describe("a stranger's lists", () => {
  const search: DiscoverInput = { cities: [CITY], scope: "saved", sort: "most-added", budget: "any", length: "any" };

  // 2026-11-22: an entry per search, cursor and page let a crawler find a key
  // nobody had asked for almost every time, and each was a database read.
  it("are all answered from one snapshot of the library, read once, and Discover is live for a reader signed in", async () => {
    const id = await day();

    const stranger = await discoverFor(search, null);
    await discoverFor({ ...search, sort: "newest" }, null);
    await discoverFor({ ...search, after: id }, null);
    await publishedDaysPage({ cities: [CITY] }, { limit: 24, offset: 0 });
    await publishedDaysPage({ authorId: AUTHOR }, { limit: 24, offset: 24 });

    expect(stranger.days.map((d) => d.savedDayId)).toContain(id);
    // One read of the library; the tag lattice its cards link by is its own entry.
    expect([...cache.reads].filter(([key]) => !key.endsWith(",tags"))).toEqual([[expect.stringMatching(/,snapshot$/), 1]]);
    // Saved is theirs alone: a reader who saved nothing gets nothing, never
    // the Everyone list a stranger's search would show.
    expect((await discoverFor(search, READER)).days).toEqual([]);
  });

  // Publish and unpublish clear `LIBRARY_TAG` and never `discover-rank`; the
  // cron clears `discover-rank` and never the library. The snapshot must hang
  // from both, or a day that left stays listed until the other tag clears.
  it("hold the snapshot under the library tag and the rank tag", async () => {
    await day();

    await discoverFor(search, null);

    const [entry] = [...cache.entries].filter(([key]) => key.endsWith(",snapshot"));
    expect([...entry![1].tags].sort()).toEqual(["discover-rank", "library"]);
  });

  /** A library bigger than one cache entry may be: a real day's entry, four thousand times over. */
  async function tooBigToCache(id: string) {
    const real = (await readLibrarySnapshot()).find((entry) => entry.id === id)!;
    vi.mocked(readLibrarySnapshot).mockResolvedValueOnce(
      Array.from({ length: 4000 }, (_, i) => ({ ...real, id: `big-${i}`, card: { ...real.card!, name: "x".repeat(400) } })),
    );
  }

  // Next stores nothing over 2 MB, which would make every list a read again.
  it("fall back to an entry per URL when the library is too big for one, deciding that once", async () => {
    const id = await day();
    await tooBigToCache(id);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const first = await discoverFor(search, null);
    await discoverFor(search, null);
    await publishedDaysPage({ cities: [CITY] }, { limit: 24, offset: 0 });

    expect(first.days.map((d) => d.savedDayId)).toContain(id);
    expect(readsOf("snapshot")).toBe(1);
    expect([...cache.reads].filter(([key]) => key.includes("discover")).map(([, reads]) => reads)).toEqual([1]);
    expect([...cache.reads].filter(([key]) => key.includes("days")).map(([, reads]) => reads)).toEqual([1]);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("too large"), expect.anything());
    error.mockRestore();
  });

  // The place, tag, length and author pages list by `top` too, so in the
  // fallback they hang from the rank tag as well; an author's adds its own.
  it("hold a place page and an author page under the rank tag in the fallback", async () => {
    await tooBigToCache(await day());
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await publishedDaysPage({ cities: [CITY] }, { limit: 24, offset: 0 });
    await publishedDaysPage({ authorId: AUTHOR }, { limit: 24, offset: 0 });

    const pages = [...cache.entries].filter(([key]) => key.includes("days"));
    expect(pages.map(([, entry]) => [...entry.tags].sort())).toEqual([
      ["discover-rank", "library"],
      [`author:${AUTHOR}`, "discover-rank", "library"],
    ]);
    error.mockRestore();
  });
});
