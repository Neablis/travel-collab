import { ReviewStars } from "@tc/contracts";

// §15's offline state: a review written with no connection is **held on the
// device and badged Queued**, then posted on reconnect (M12 link 3).
//
// `localStorage`, not memory, so a held review survives the tab being closed
// before the connection comes back — the ordinary way somebody leaves a page
// they could not post from. Not a table and not the event log: a review is not
// trip state (M12 link 1), and one that has not been sent is not even a review
// yet.
//
// **Every access is wrapped**, following `askThreadStore.ts` and
// `lib/pendingDemoClone.ts`: Safari's private mode throws on `localStorage`, a
// full origin throws on write, and KI-2026-09-02-a records a jsdom with no
// `localStorage` at all. Losing a held review to any of those is the same
// outcome as never having been able to hold it, and must not break the page.
//
// **Keyed by day, not by person.** The browser is never handed the signed-in id
// (`api/saved-days/[savedDayId]/route.ts`), so a second account signing in on
// the same browser would find the first one's held review on that day. The
// server still attributes the post to whoever is signed in when it flushes.

/** Versioned so a shape change abandons old values instead of misreading them. */
const KEY_PREFIX = "held_review_v1";

/** A review written while offline, waiting to be sent. */
export type HeldReview = {
  stars: number;
  note: string | null;
  /**
   * The day's `publishedAt` as it was when the review was written — sent as
   * `seenPublishedAt` on flush, so a day its author republished in the meantime
   * answers with §15's conflict banner instead of taking the stars.
   *
   * **Absent when the page did not know it**, and then the flush asks for no
   * check. That is distinct from `null` (the reviewer saw it unpublished), the
   * same three-way reading `PutReviewInput.seenPublishedAt` gives it.
   */
  seenPublishedAt?: string | null;
  heldAt: string;
};

/** The subset of `Storage` this module touches — injectable, so a test can refuse. */
export type ReviewStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function browserStorage(): ReviewStorage | null {
  try {
    return typeof window === "undefined" ? null : (window.localStorage ?? null);
  } catch {
    return null;
  }
}

function keyFor(savedDayId: string): string {
  return `${KEY_PREFIX}:${savedDayId}`;
}

/**
 * The review held for this day, or null. Never throws; a value this build
 * cannot read is no held review, rather than a render crash on the one page the
 * person came back to.
 */
export function loadHeldReview(savedDayId: string, storage = browserStorage()): HeldReview | null {
  try {
    const raw = storage?.getItem(keyFor(savedDayId)) ?? null;
    if (raw === null) return null;
    const value: unknown = JSON.parse(raw);
    return isHeldReview(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Hold a review for this day, replacing any held before — one review per person
 * per day, offline as online. Returns whether it was stored, so the caller can
 * say so when the device refused.
 */
export function holdReview(savedDayId: string, review: HeldReview, storage = browserStorage()): boolean {
  try {
    if (storage === null) return false;
    storage.setItem(keyFor(savedDayId), JSON.stringify(review));
    return true;
  } catch {
    return false;
  }
}

/** Forget the held review for this day — after it posts, or when it is discarded. */
export function clearHeldReview(savedDayId: string, storage = browserStorage()): void {
  try {
    storage?.removeItem(keyFor(savedDayId));
  } catch {
    // See `holdReview`.
  }
}

function isHeldReview(value: unknown): value is HeldReview {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    ReviewStars.safeParse(v.stars).success &&
    (v.note === null || typeof v.note === "string") &&
    (v.seenPublishedAt === undefined || v.seenPublishedAt === null || typeof v.seenPublishedAt === "string") &&
    typeof v.heldAt === "string"
  );
}
