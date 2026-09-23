import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { SavedDayVisibility } from "@tc/contracts";
import { scenarios } from "@tc/factories";
import { db } from "./db/client";
import { savedDayReviews, savedDays } from "./db/schema";
import { deleteReview, lockSavedDayForReviewWrite, putReview, recomputeReviewCounters } from "./reviews";
import { saveDay, setSavedDayVisibility } from "./savedDays";
import { reviewCounterDrift } from "./test-support/reviewCounters";

// M12 link 2's gate box: **`saved_days.rating` and `review_count` cannot drift
// from `saved_day_reviews`**, and a test fails if they do. Every write path is
// walked and, after each step, the stored counters are compared with an
// independent aggregate over the rows (`reviewCounterDrift`) as well as with
// the number a person would work out by hand.
//
// Owners and reviewers are minted per test and every drift check is scoped to
// this file's own days (KI-69). Not the whole table: the Discover sort and
// board tests write `rating` / `review_count` directly as fixtures, which is
// drift by construction, so an unscoped check here would be an assertion about
// which files ran first.

let OWNER = "";
beforeEach(() => {
  OWNER = `m12-owner-${randomUUID().slice(0, 8)}`;
});

/** A one-day Playbook from the factory's ordinary trip, published by OWNER. */
async function publishedDay(): Promise<string> {
  const detail = scenarios.threeDayTrip();
  const saved = await saveDay({ name: "A reviewed day", dayIds: [detail.days[0]!.dayId] }, detail, OWNER);
  if (!saved.ok) throw new Error(saved.error.message);
  await setSavedDayVisibility(saved.value.savedDayId, OWNER, SavedDayVisibility.enum.public);
  return saved.value.savedDayId;
}

async function counters(savedDayId: string) {
  const [row] = await db
    .select({ rating: savedDays.rating, reviewCount: savedDays.reviewCount })
    .from(savedDays)
    .where(eq(savedDays.id, savedDayId));
  return row;
}

const reviewer = () => `m12-reviewer-${randomUUID().slice(0, 8)}`;

describe("the review counters", () => {
  it("equal the rows after a create, an update, and a withdrawal", async () => {
    const id = await publishedDay();
    const [a, b] = [reviewer(), reviewer()];

    const steps: [string, () => Promise<unknown>, { rating: number | null; reviewCount: number }][] = [
      ["a rates 5", () => putReview(id, a, { stars: 5, note: null }), { rating: 5, reviewCount: 1 }],
      ["b rates 2", () => putReview(id, b, { stars: 2, note: "Rushed." }), { rating: 3.5, reviewCount: 2 }],
      // An UPDATE of a's row, not a third review: the count stays at two.
      ["a re-rates 3", () => putReview(id, a, { stars: 3, note: null }), { rating: 2.5, reviewCount: 2 }],
      ["b withdraws", () => deleteReview(id, b), { rating: 3, reviewCount: 1 }],
      // The last review going back to "nobody has rated this yet" — null, not 0.
      ["a withdraws", () => deleteReview(id, a), { rating: null, reviewCount: 0 }],
    ];
    for (const [step, write, expected] of steps) {
      await write();
      expect(await counters(id), step).toEqual(expected);
      expect(await reviewCounterDrift([id]), step).toEqual([]);
    }
  });

  it("leave a hidden review out, once recomputed", async () => {
    const id = await publishedDay();
    const [a, b] = [reviewer(), reviewer()];
    await putReview(id, a, { stars: 5, note: null });
    await putReview(id, b, { stars: 1, note: null });

    // The moderation write, in the shape Unit 3's hide will take: lock, hide,
    // recompute, in one transaction.
    await db.transaction(async (tx) => {
      await lockSavedDayForReviewWrite(tx, id);
      await tx
        .update(savedDayReviews)
        .set({ hiddenAt: new Date() })
        .where(and(eq(savedDayReviews.savedDayId, id), eq(savedDayReviews.reviewerId, b)));
      await recomputeReviewCounters(tx, id);
    });

    expect(await counters(id)).toEqual({ rating: 5, reviewCount: 1 });
    expect(await reviewCounterDrift([id])).toEqual([]);
  });

  // Without the parent-row lock this interleaves: each writer aggregates from
  // a snapshot that misses the others' uncommitted rows, and the last commit
  // stores a count short of the truth. Measured 2026-09-23 with `.for("update")`
  // removed: red in 3 runs of 3, storing 2 or 3 where 12 was true.
  it("stay true when many reviewers post at once", async () => {
    const id = await publishedDay();
    const people = Array.from({ length: 12 }, reviewer);
    await Promise.all(people.map((p, i) => putReview(id, p, { stars: (i % 5) + 1, note: null })));

    expect((await counters(id))?.reviewCount).toBe(12);
    expect(await reviewCounterDrift([id])).toEqual([]);
  });

  // The check itself has to be able to fail, or every "no drift" above is
  // an assertion about nothing.
  it("are reported when they drift from the rows", async () => {
    const id = await publishedDay();
    await putReview(id, reviewer(), { stars: 4, note: null });
    await db.update(savedDays).set({ reviewCount: 7 }).where(eq(savedDays.id, id));

    expect(await reviewCounterDrift([id])).toEqual([
      { savedDayId: id, stored: { rating: 4, reviewCount: 7 }, actual: { rating: 4, reviewCount: 1 } },
    ]);

    // Put it back through the one writer, and the check agrees again.
    await recomputeReviewCounters(db, id);
    expect(await reviewCounterDrift([id])).toEqual([]);
  });
});
