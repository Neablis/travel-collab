"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { REVIEW_NOTE_MAX, type PutReviewInput, type ReviewDayChanged, type SavedDayReviewsResponse } from "@tc/contracts";
import { fetchReviews, putReview, type ApiError, type PutReviewOutcome } from "@/lib/apiClient";
import { clearHeldReview, holdReview, loadHeldReview, type HeldReview } from "./reviewQueue";
import { useOnline } from "./useOnline";

/** Everything the rail, the review section and the conflict banner read and do. */
export type DayReviews = {
  /** The server's answer, or null until the first read lands (or when it failed). */
  data: SavedDayReviewsResponse | null;
  loadFailed: boolean;
  reload: () => void;
  online: boolean;
  /** A review written offline and not yet accepted — shown badged *Queued*. */
  held: HeldReview | null;
  /** Set when a held review's flush found the day republished since it was written. */
  conflict: ReviewDayChanged | null;
  busy: boolean;
  error: string | null;
  /** Post (online) or hold (offline). Resolves true when the review was posted or held. */
  post: (stars: number, note: string) => Promise<boolean>;
  /** The conflict banner's "post it anyway": the held review, with no staleness check. */
  postAnyway: () => Promise<void>;
  /** Drop the held review without sending it. */
  discardHeld: () => void;
};

/**
 * A shared day's reviews (M12 links 3-4): one read, the reader's own post, and
 * §15's two non-empty states — offline (held on the device) and conflict (the
 * day changed while the review was held).
 *
 * `publishedAt` is the day's publish time as this page read it, recorded on a
 * held review so its flush can ask the server whether the day moved. `undefined`
 * means the page does not know it, and a held review then flushes unchecked.
 *
 * **The average recomputes live from the PUT's own summary**, never from a
 * re-read: the server computes it from the rows under the same lock that wrote
 * the review, so the response is already the number a reload would show.
 */
export function useDayReviews(savedDayId: string, publishedAt: string | null | undefined): DayReviews {
  const online = useOnline();
  const [data, setData] = useState<SavedDayReviewsResponse | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [readCount, setReadCount] = useState(0);
  const [held, setHeld] = useState<HeldReview | null>(null);
  const [conflict, setConflict] = useState<ReviewDayChanged | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One flush at a time. A ref, not state: StrictMode runs the effect below
  // twice on mount, and two PUTs of the same held review would both succeed —
  // harmless for the row, but the second would race the first's summary.
  const flushing = useRef(false);

  useEffect(() => {
    let live = true;
    void fetchReviews(savedDayId).then((result) => {
      if (!live) return;
      if (result.ok) {
        setData(result.value);
        setLoadFailed(false);
      } else {
        setLoadFailed(true);
      }
    });
    return () => {
      live = false;
    };
  }, [savedDayId, readCount]);

  // Read in an effect, not a state initialiser: the server render has no
  // storage, and a first client render that differed from it would be a
  // hydration mismatch on every page with a held review.
  useEffect(() => {
    setHeld(loadHeldReview(savedDayId));
    setConflict(null);
  }, [savedDayId]);

  const accept = useCallback(
    (outcome: Extract<PutReviewOutcome, { kind: "saved" }>) => {
      setData((prev) => ({
        summary: outcome.summary,
        // One review per person per day: the post REPLACES the reader's row.
        reviews: [outcome.review, ...(prev?.reviews ?? []).filter((r) => !r.isMine)],
        mine: outcome.review,
      }));
      clearHeldReview(savedDayId);
      setHeld(null);
      setConflict(null);
      setError(null);
    },
    [savedDayId],
  );

  const send = useCallback(
    async (input: PutReviewInput): Promise<boolean> => {
      setBusy(true);
      setError(null);
      const result = await putReview(savedDayId, input);
      setBusy(false);
      if (!result.ok) {
        setError(refusal(result.error));
        return false;
      }
      if (result.value.kind === "day-changed") {
        setConflict(result.value.changed);
        return false;
      }
      accept(result.value);
      return true;
    },
    [savedDayId, accept],
  );

  const flush = useCallback(
    async (review: HeldReview) => {
      flushing.current = true;
      await send({
        stars: review.stars,
        note: review.note,
        // Omitted, not sent as undefined-in-JSON, when the page never knew it —
        // absent is "do not check" to the server.
        ...(review.seenPublishedAt !== undefined ? { seenPublishedAt: review.seenPublishedAt } : {}),
      });
      flushing.current = false;
    },
    [send],
  );

  // A flush that failed stops the effect below from trying again in a loop;
  // losing the connection clears that, so the next reconnect is a fresh try.
  useEffect(() => {
    if (!online) setError(null);
  }, [online]);

  // Reconnecting — and opening the page already online with a review held from
  // last time — sends it. Not while a conflict is waiting on the person: that
  // decision is theirs, and re-sending would only get the same 409.
  useEffect(() => {
    if (!online || held === null || conflict !== null || error !== null || flushing.current) return;
    void flush(held);
  }, [online, held, conflict, error, flush]);

  const post = useCallback(
    async (stars: number, note: string): Promise<boolean> => {
      const trimmed = note.trim();
      if (!online) {
        const review: HeldReview = {
          stars,
          note: trimmed === "" ? null : trimmed,
          ...(publishedAt !== undefined ? { seenPublishedAt: publishedAt } : {}),
          heldAt: new Date().toISOString(),
        };
        if (!holdReview(savedDayId, review)) {
          setError("This browser would not keep your review, so it cannot be held. Post it once you are back online.");
          return false;
        }
        setHeld(review);
        setError(null);
        return true;
      }
      // Online, the reader has just read the day: nothing stale to check.
      return send({ stars, note: trimmed === "" ? null : trimmed });
    },
    [online, publishedAt, savedDayId, send],
  );

  const postAnyway = useCallback(async () => {
    if (held === null) return;
    await send({ stars: held.stars, note: held.note });
  }, [held, send]);

  const discardHeld = useCallback(() => {
    clearHeldReview(savedDayId);
    setHeld(null);
    setConflict(null);
    setError(null);
  }, [savedDayId]);

  const reload = useCallback(() => setReadCount((n) => n + 1), []);

  return { data, loadFailed, reload, online, held, conflict, busy, error, post, postAnyway, discardHeld };
}

/** What a refused post says. `message` carries the route's `error` string (`readJson`). */
function refusal(error: ApiError): string {
  if (error.status === 400) return `That review was refused — a note can be at most ${REVIEW_NOTE_MAX} characters.`;
  if (error.status === 403) return "This is your own day, so it is not yours to rate.";
  if (error.status === 404) return "This day is no longer in the library, so it cannot be rated.";
  return "Your review did not post. Try again.";
}
