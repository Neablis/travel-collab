import { z } from "zod";

// Reviews of a published Playbook (M12 links 1-4).
//
// **A review attaches to the `saved_days` row — the whole sequence — not to a
// day inside it** (M12 D1). That row is the unit that is published, added,
// ranked and rendered as one Discover card; a rating on "day 2 of 3" would be a
// number no surface shows.
//
// Not trip state, so not events: a review is not versioned, not undoable and
// not part of any trip's history, which is ADR-029's argument for saved days
// applied one table over. Ordinary CRUD, ordinary table (`saved_day_reviews`).

/** 1-5 whole stars. Required: a note with no stars is not a review. */
export const ReviewStars = z.number().int().min(1).max(5);
export type ReviewStars = z.infer<typeof ReviewStars>;

/** SPEC §15's cap, in characters. `saved_day_reviews_note_length` repeats the number. */
export const REVIEW_NOTE_MAX = 140;

/**
 * An optional free-text note, **refused past 140 characters rather than
 * truncated** — M12's gate box, and the reason this is a contract and not a UI
 * `maxLength`.
 *
 * Counted in CODE POINTS after trimming, because that is what the column's
 * `char_length(note) <= 140` CHECK counts. `z.string().max()` counts UTF-16
 * units, and the two disagree on anything outside the BMP: the contract would
 * refuse a note the database accepts. Whitespace-only reads as no note, so
 * "a note" always means there is something to render.
 */
export function boundedNote(max: number) {
  return z
    .string()
    .trim()
    .refine((s) => [...s].length <= max, { message: `At most ${max} characters.` })
    .transform((s) => (s === "" ? null : s))
    .nullable();
}

export const ReviewNote = boundedNote(REVIEW_NOTE_MAX);
export type ReviewNote = z.infer<typeof ReviewNote>;

/**
 * `PUT /api/saved-days/:id/review` — create or replace the caller's review.
 * One review per person per day is the table's primary key, so a second PUT is
 * an update by construction, not a second row.
 */
export const PutReviewInput = z.object({
  stars: ReviewStars,
  note: ReviewNote.default(null),
  /**
   * The day's `publishedAt` as the reviewer last saw it — §15's conflict state
   * (M12 D4). A review queued offline flushes later; if the author republished
   * in between, the server answers 409 `ReviewDayChanged` rather than attaching
   * stars to a day the reviewer never read.
   *
   * **Absent means "do not check"**, and that is distinct from `null` (the
   * reviewer saw it unpublished). An online post has just read the day and has
   * nothing stale to guard against.
   */
  seenPublishedAt: z.string().datetime().nullable().optional(),
});
export type PutReviewInput = z.infer<typeof PutReviewInput>;

/** The 409 body for a stale `seenPublishedAt` — "Mei changed this day two days ago". */
export const ReviewDayChanged = z.object({
  error: z.literal("day-changed"),
  changedAt: z.string().datetime(),
  authorDisplayName: z.string().min(1),
});
export type ReviewDayChanged = z.infer<typeof ReviewDayChanged>;

export const Review = z.object({
  savedDayId: z.string().uuid(),
  reviewerId: z.string().min(1),
  reviewerDisplayName: z.string().min(1),
  stars: ReviewStars,
  note: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Whether the signed-in reader wrote it — the rail's "edit yours" affordance. */
  isMine: z.boolean(),
});
export type Review = z.infer<typeof Review>;

const bucket = z.number().int().nonnegative();

/**
 * The rating rail: the average, the count, and §15's 5→1 histogram.
 *
 * `average` is null exactly when `count` is 0 — "nobody has rated this yet" is
 * a state, and a 0.0 average would be a claim. Every bucket is present, zeros
 * included, so the rail never has to invent one. Hidden (moderated) reviews
 * count nowhere here.
 */
export const ReviewSummary = z.object({
  average: z.number().min(1).max(5).nullable(),
  count: z.number().int().nonnegative(),
  histogram: z.object({ 1: bucket, 2: bucket, 3: bucket, 4: bucket, 5: bucket }),
});
export type ReviewSummary = z.infer<typeof ReviewSummary>;

export const SavedDayReviewsResponse = z.object({
  summary: ReviewSummary,
  reviews: z.array(Review),
  /** The reader's own review, or null. Also present in `reviews`. */
  mine: Review.nullable(),
});
export type SavedDayReviewsResponse = z.infer<typeof SavedDayReviewsResponse>;
