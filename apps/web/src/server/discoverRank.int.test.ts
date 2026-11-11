import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "./db/client";
import { savedDayAdds, savedDayRanks, savedDayReviews, savedDays } from "./db/schema";
import { recomputeDiscoverRanks } from "./discoverRank";
import { setSavedDayVisibility } from "./savedDays";

// M61 part 1's gate boxes: *each signal moves a day the right way*, *stars
// can't carry a day alone*, and the score half of *new days are seen*. The
// score is a number a person could work out by hand, so each test compares two
// days that differ in exactly one thing and asserts the direction (and, where
// the constants make it exact, the value).
//
// The library mean is global, so the tables are emptied first: another file's
// leftover reviews would move it. The files run one after another against one
// database (`fileParallelism: false`) and mint their own rows, so nothing here
// is read by another file. `afterAll` empties them again so that stays true.

const NOW = new Date("2026-06-01T12:00:00.000Z");
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
const ahead = (days: number) => new Date(NOW.getTime() + days * DAY);

const empty = () =>
  db.execute(sql`truncate saved_day_ranks, saved_day_reviews, saved_day_adds, saved_days`);

beforeEach(empty);
afterAll(empty);

type DayOpts = {
  publishedAt?: Date;
  visibility?: "public" | "private";
  deletedAt?: Date | null;
  moderatedAt?: Date | null;
};

/** A public day published long enough ago that its new-day lift is negligible. */
async function day(opts: DayOpts = {}): Promise<string> {
  const id = randomUUID();
  const publishedAt = opts.publishedAt ?? ago(365);
  await db.insert(savedDays).values({
    id,
    ownerId: "owner",
    name: "A day",
    stops: [],
    visibility: opts.visibility ?? "public",
    publishedAt,
    deletedAt: opts.deletedAt ?? null,
    moderatedAt: opts.moderatedAt ?? null,
    sourceTripId: randomUUID(),
    sourceTripName: "Trip",
    createdAt: publishedAt,
  });
  return id;
}

/** One add per entry; the same person may appear more than once (three trips). */
async function addedBy(savedDayId: string, adds: { by: string; at: Date }[]) {
  await db
    .insert(savedDayAdds)
    .values(adds.map((a) => ({ savedDayId, tripId: randomUUID(), addedBy: a.by, createdAt: a.at })));
}

async function review(
  savedDayId: string,
  r: { stars: number; note?: string | null; at?: Date; createdAt?: Date; hidden?: boolean },
) {
  await db.insert(savedDayReviews).values({
    savedDayId,
    reviewerId: `reviewer-${randomUUID().slice(0, 8)}`,
    stars: r.stars,
    note: r.note ?? null,
    hiddenAt: r.hidden ? NOW : null,
    createdAt: r.createdAt ?? r.at ?? NOW,
    updatedAt: r.at ?? NOW,
  });
}

async function reviews(savedDayId: string, stars: number[]) {
  for (const s of stars) await review(savedDayId, { stars: s });
}

async function rank(savedDayId: string) {
  const [row] = await db.select().from(savedDayRanks).where(eq(savedDayRanks.savedDayId, savedDayId));
  if (!row) throw new Error("no rank row");
  return row;
}

const recompute = (now: Date = NOW) => recomputeDiscoverRanks({ now });

describe("each signal moves a day the right way", () => {
  it("ranks a day with more recent adds above one with fewer", async () => {
    const more = await day();
    const fewer = await day();
    await addedBy(more, [
      { by: "a", at: ago(1) },
      { by: "b", at: ago(1) },
    ]);
    await addedBy(fewer, [{ by: "a", at: ago(1) }]);
    await recompute();
    expect((await rank(more)).score).toBeGreaterThan((await rank(fewer)).score);
  });

  it("ranks the same adds a half-life older lower, at half the weight", async () => {
    const fresh = await day();
    const stale = await day();
    await addedBy(fresh, [{ by: "a", at: NOW }]);
    // Literal 14 days, not `RANK_CONSTANTS`: a test that reads the constant it
    // protects moves with it and proves nothing about the half-life.
    await addedBy(stale, [{ by: "a", at: ago(14) }]);
    await recompute();
    const [f, s] = [await rank(fresh), await rank(stale)];
    expect(s.score).toBeLessThan(f.score);
    expect(f.addsRecent).toBeCloseTo(1, 9);
    expect(s.addsRecent).toBeCloseTo(0.5, 9);
  });

  it("counts one person adding a day to three trips once", async () => {
    const oneAdder = await day();
    const threeAdders = await day();
    await addedBy(oneAdder, [
      { by: "a", at: ago(3) },
      { by: "a", at: ago(2) },
      { by: "a", at: ago(1) },
    ]);
    await addedBy(threeAdders, [
      { by: "a", at: ago(1) },
      { by: "b", at: ago(1) },
      { by: "c", at: ago(1) },
    ]);
    await recompute();
    const one = await rank(oneAdder);
    // At their latest add (1 day old), not summed over the three.
    expect(one.addsRecent).toBeCloseTo(0.5 ** (1 / 14), 6);
    expect((await rank(threeAdders)).addsRecent).toBeCloseTo(3 * one.addsRecent, 6);
  });

  it("ranks more recent comments above fewer, and a month-old comment lower", async () => {
    const more = await day();
    const fewer = await day();
    const old = await day();
    await review(more, { stars: 4, note: "Loved it", at: ago(1) });
    await review(more, { stars: 4, note: "Great", at: ago(1) });
    await review(fewer, { stars: 4, note: "Loved it", at: ago(1) });
    await review(old, { stars: 4, note: "Loved it", at: ago(31) });
    await recompute();
    const [m, f, o] = [await rank(more), await rank(fewer), await rank(old)];
    expect(m.score).toBeGreaterThan(f.score);
    expect(o.score).toBeLessThan(f.score);
    // 31 days against 1: exactly 30, one comment half-life apart.
    expect(f.commentsRecent).toBeCloseTo(0.5 ** (1 / 30), 6);
    expect(o.commentsRecent).toBeCloseTo(0.5 ** (31 / 30), 6);
  });

  it("does not count a star-only or blank-note review as a comment", async () => {
    const quiet = await day();
    await review(quiet, { stars: 5, note: null, at: ago(1) });
    await review(quiet, { stars: 5, note: "   ", at: ago(1) });
    await recompute();
    expect((await rank(quiet)).commentsRecent).toBe(0);
  });

  it("ranks better stars above worse ones, with the adds equal", async () => {
    const good = await day();
    const poor = await day();
    for (const id of [good, poor]) await addedBy(id, [{ by: "a", at: ago(1) }]);
    await reviews(good, [5, 5, 5]);
    await reviews(poor, [1, 1, 1]);
    await recompute();
    const [g, p] = [await rank(good), await rank(poor)];
    expect(g.quality).toBeGreaterThan(p.quality);
    expect(g.score).toBeGreaterThan(p.score);
  });

  it("counts a hidden review for nothing", async () => {
    const hidden = await day();
    const bare = await day();
    // A visible review elsewhere, so the library mean is not zero: with no
    // mean, quality is 1 whether or not the hidden review is read.
    await reviews(await day(), [3]);
    for (const id of [hidden, bare]) await addedBy(id, [{ by: "a", at: ago(1) }]);
    await review(hidden, { stars: 1, note: "Awful", at: ago(1), hidden: true });
    await recompute();
    const [h, b] = [await rank(hidden), await rank(bare)];
    expect(h.commentsRecent).toBe(0);
    expect(h.quality).toBe(1);
    expect(h.score).toBeCloseTo(b.score, 9);
  });
});

/**
 * A library worked out by hand. Day T: one add 14 days ago, one 4-star comment
 * whose note was last edited 30 days ago (written 60 days ago), published 7
 * days ago. Day L: two 2-star reviews. Reviews that must not move the library
 * mean: a hidden 5 star on L, and two 5 stars on a private day.
 */
async function handWorkedLibrary() {
  const t = await day({ publishedAt: ago(7) });
  const l = await day();
  const hiddenElsewhere = await day({ visibility: "private" });
  await addedBy(t, [{ by: "a", at: ago(14) }]);
  await review(t, { stars: 4, note: "Good", createdAt: ago(60), at: ago(30) });
  await reviews(l, [2, 2]);
  await review(l, { stars: 5, hidden: true });
  await reviews(hiddenElsewhere, [5, 5]);
  return t;
}

// m = (4 + 2 + 2) / 3 = 8/3. bayes = (5 * 8/3 + 4) / (5 + 1) = 26/9.
// quality = (26/9) / (8/3) = 13/12. adds = 0.5, comments = 0.5 (30 days is one
// half-life), lift = 4 * 0.5 (7 days is one). interest = 3 * 0.5 + 2 * 0.5 = 2.5.
// score = 13/12 * (2.5 + 2) = 4.875.
describe("the score, worked by hand from literals", () => {
  it("gives a full run the hand-worked score, quality and lift", async () => {
    const t = await handWorkedLibrary();
    await recompute();
    const row = await rank(t);
    expect(row.addsRecent).toBeCloseTo(0.5, 9);
    expect(row.commentsRecent).toBeCloseTo(0.5, 9);
    expect(row.newDayLift).toBeCloseTo(2, 9);
    expect(row.quality).toBeCloseTo(13 / 12, 9);
    expect(row.score).toBeCloseTo(4.875, 9);
  });

  it("gives a one-day run the same row as a full run, the library mean taken library-wide", async () => {
    const t = await handWorkedLibrary();
    await recomputeDiscoverRanks({ savedDayId: t, now: NOW });
    const row = await rank(t);
    expect(row.quality).toBeCloseTo(13 / 12, 9);
    expect(row.score).toBeCloseTo(4.875, 9);
  });
});

describe("stars can't carry a day alone", () => {
  it("ranks one 5-star review below twenty reviews averaging 4.6, adds equal", async () => {
    const lone = await day();
    const solid = await day();
    // A middling library, so the mean sits below both days' own stars.
    const filler = await day();
    for (const id of [lone, solid]) await addedBy(id, [{ by: "a", at: ago(1) }]);
    await reviews(lone, [5]);
    await reviews(solid, [...Array<number>(12).fill(5), ...Array<number>(8).fill(4)]);
    await reviews(filler, Array<number>(30).fill(3));
    await recompute();
    const [l, s] = [await rank(lone), await rank(solid)];
    expect(s.quality).toBeGreaterThan(l.quality);
    expect(s.score).toBeGreaterThan(l.score);
  });

  it("clamps quality to 0.7 to 1.3", async () => {
    const glowing = await day();
    const dire = await day();
    const filler = await day();
    // A library mean of 3 and a day at 5 stars would be well past 1.3 unclamped.
    await reviews(glowing, Array<number>(100).fill(5));
    await reviews(dire, Array<number>(100).fill(1));
    await reviews(filler, Array<number>(100).fill(3));
    await recompute();
    // Literals, not `RANK_CONSTANTS`: unclamped these are about 1.64 and 0.37.
    expect((await rank(glowing)).quality).toBe(1.3);
    expect((await rank(dire)).quality).toBe(0.7);
  });

  it("scores an unrated day the same as a day rated exactly the library mean", async () => {
    const unrated = await day();
    const atMean = await day();
    const filler = await day();
    for (const id of [unrated, atMean]) await addedBy(id, [{ by: "a", at: ago(1) }]);
    // Every review is 3 stars, so the library mean is exactly 3.
    await reviews(atMean, [3, 3, 3, 3]);
    await reviews(filler, [3, 3]);
    await recompute();
    const [u, m] = [await rank(unrated), await rank(atMean)];
    expect(u.quality).toBe(1);
    expect(m.quality).toBeCloseTo(1, 9);
    expect(m.score).toBeCloseTo(u.score, 9);
  });
});

describe("new days are seen", () => {
  it("ages the lift from the first publish, not from a republish (decision 11)", async () => {
    const id = await day({ visibility: "private", publishedAt: ago(365) });
    await db.update(savedDays).set({ publishedAt: null }).where(eq(savedDays.id, id));
    await setSavedDayVisibility(id, "owner", "public", ago(10).toISOString());
    await setSavedDayVisibility(id, "owner", "private", ago(9).toISOString());
    await setSavedDayVisibility(id, "owner", "public", NOW.toISOString());

    await recompute(NOW);
    // 4 * 0.5^(10/7) from the first publish; republishing today would give 4.
    expect((await rank(id)).newDayLift).toBeCloseTo(4 * 0.5 ** (10 / 7), 9);
  });

  it("lifts a day published now above a steady one, then lets the steady one pass it after 14 days", async () => {
    const fresh = await day({ publishedAt: NOW });
    const stale = await day();
    const steady = await day();
    await addedBy(stale, [{ by: "a", at: ago(30) }]);
    // Only adds that are already in the past at each recompute: an add dated
    // after `now` would be counted at full weight.
    await addedBy(steady, [
      { by: "a", at: ago(20) },
      { by: "b", at: ago(13) },
    ]);

    await recompute(NOW);
    const first = await rank(fresh);
    // No adds and no reviews: the score is the lift alone, 4.
    expect(first.newDayLift).toBeCloseTo(4, 9);
    expect(first.score).toBeCloseTo(4, 9);
    expect(first.score).toBeGreaterThan((await rank(stale)).score);
    expect(first.score).toBeGreaterThan((await rank(steady)).score);

    // About weekly through the window, so by day 14 two more have landed.
    await addedBy(steady, [
      { by: "c", at: ahead(7) },
      { by: "d", at: ahead(13) },
    ]);
    await recompute(ahead(14));
    const after = await rank(fresh);
    // Two half-lives of seven days: a quarter of the lift is left.
    expect(after.newDayLift).toBeCloseTo(1, 9);
    expect(after.score).toBeCloseTo(1, 9);
    expect(after.score).toBeLessThan((await rank(steady)).score);
  });
});

describe("which days are scored", () => {
  it("gives a row to public live days only, and a one-day recompute touches only that row", async () => {
    const live = await day();
    const other = await day();
    await day({ visibility: "private" });
    await day({ deletedAt: NOW });
    await day({ moderatedAt: NOW });
    await recompute();
    const ids = (await db.select().from(savedDayRanks)).map((r) => r.savedDayId).sort();
    expect(ids).toEqual([live, other].sort());

    await recomputeDiscoverRanks({ savedDayId: live, now: ahead(1) });
    expect((await rank(live)).computedAt).toEqual(ahead(1));
    expect((await rank(other)).computedAt).toEqual(NOW);
  });

  it("removes the rows of days that have left the library, on a full run", async () => {
    const stays = await day();
    const priv = await day();
    const gone = await day();
    const modded = await day();
    await recompute();
    await db.update(savedDays).set({ visibility: "private" }).where(eq(savedDays.id, priv));
    await db.update(savedDays).set({ deletedAt: NOW }).where(eq(savedDays.id, gone));
    await db.update(savedDays).set({ moderatedAt: NOW }).where(eq(savedDays.id, modded));
    await recompute(ahead(1));
    const ids = (await db.select().from(savedDayRanks)).map((r) => r.savedDayId);
    expect(ids).toEqual([stays]);
  });

  it("removes only that day's row when a one-day run finds it has left the library", async () => {
    const a = await day();
    const b = await day();
    await recompute();
    await db.update(savedDays).set({ visibility: "private" }).where(eq(savedDays.visibility, "public"));
    await recomputeDiscoverRanks({ savedDayId: a, now: ahead(1) });
    const ids = (await db.select().from(savedDayRanks)).map((r) => r.savedDayId);
    expect(ids).toEqual([b]);
  });
});
