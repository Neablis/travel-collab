"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { DataText } from "@/components/ui/data-text";
import { Heading } from "@/components/ui/heading";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/cn";
import { formatRelativeInstant } from "@/lib/formatDate";
import { initialsFor } from "@/lib/initials";
import { ReportAction } from "./ReportDialog";
import { Stars } from "./Stars";
import { noteCharsLeft, noteCountLabel, reviewMeta, starWord, starsPhrase } from "./reviewDisplay";
import type { DayReviews } from "./useDayReviews";

type Row = {
  key: string;
  who: string;
  stars: number;
  note: string | null;
  when: string;
  badge: "Yours" | "Queued" | null;
  /** Set on somebody else's review — the only kind a reader may report. */
  reviewerId: string | null;
};

/**
 * "What people said" (§15, `dc.html:2804`): the form that rates the day, the
 * reader's own review once it exists, and everybody's — newest first.
 *
 * `canReview` is false for the day's author. The server refuses them (403
 * `own-day`, "the author is not their own audience"), so offering a form that
 * can only fail would be a control that does nothing; they still see the list.
 */
export function ReviewsSection({
  reviews,
  savedDayId,
  canReview,
}: {
  reviews: DayReviews;
  savedDayId: string;
  canReview: boolean;
}) {
  const { data, held, online, busy, error } = reviews;
  const [editing, setEditing] = useState(false);
  const [stars, setStars] = useState<number | null>(null);
  const [note, setNote] = useState("");

  // A held review stands in for the posted one until it is sent: it is the
  // newer of the two, and it is what will replace it.
  const own = held ?? data?.mine ?? null;
  const showDone = own !== null && !editing;
  const over = noteCharsLeft(note) < 0;

  async function submit() {
    if (stars === null) return;
    if (await reviews.post(stars, note)) {
      setEditing(false);
      setStars(null);
      setNote("");
    }
  }

  const rows: Row[] = [];
  if (held !== null) {
    rows.push({ key: "held", who: "You", stars: held.stars, note: held.note, when: "not sent", badge: "Queued", reviewerId: null });
  }
  for (const r of data?.reviews ?? []) {
    if (r.isMine && held !== null) continue;
    rows.push({
      key: r.reviewerId,
      who: r.isMine ? "You" : r.reviewerDisplayName,
      stars: r.stars,
      note: r.note,
      when: formatRelativeInstant(r.updatedAt) ?? "",
      badge: r.isMine ? "Yours" : null,
      reviewerId: r.isMine ? null : r.reviewerId,
    });
  }

  return (
    <section className="flex flex-col gap-3.5 border-t border-hairline pt-1.5" aria-labelledby="reviews-heading">
      <div className="flex flex-wrap items-baseline gap-2.5">
        <Heading level={3} id="reviews-heading">
          What people said
        </Heading>
        {data !== null && (
          <DataText size="xs" data-testid="review-meta">
            {reviewMeta(data.summary.count)}
          </DataText>
        )}
      </div>

      {canReview && (
        <div className="flex flex-col gap-2.5 rounded-lg border border-hairline bg-surface p-3.5" data-testid="review-form">
          {showDone ? (
            <div className="flex flex-wrap items-center gap-2.5">
              <Text as="span" className="text-sm" data-testid="review-done">
                {held !== null
                  ? `Your ${held.stars}-star review is waiting to send.`
                  : `You rated this ${starsPhrase(own.stars)}.`}
              </Text>
              <Button
                variant="ghost"
                size="sm"
                className="text-brand underline underline-offset-2"
                onClick={() => {
                  setStars(own.stars);
                  setNote(own.note ?? "");
                  setEditing(true);
                }}
              >
                Change it
              </Button>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <Text as="span" className="text-sm font-semibold">
                  Rate this day
                </Text>
                <div className="flex items-center gap-0.5">
                  {[1, 2, 3, 4, 5].map((v) => (
                    <Button
                      key={v}
                      variant="ghost"
                      size="icon"
                      aria-label={starsPhrase(v)}
                      aria-pressed={stars === v}
                      className={cn("text-xl leading-none", stars !== null && v <= stars ? "text-warning" : "text-hairline")}
                      onClick={() => setStars(v)}
                    >
                      ★
                    </Button>
                  ))}
                </div>
                <Text as="span" variant="secondary" data-testid="star-word">
                  {starWord(stars)}
                </Text>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  aria-label="Your note"
                  aria-describedby="review-note-count"
                  placeholder="One line, if you have one — what would you tell the next person?"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <DataText
                  size="xs"
                  id="review-note-count"
                  className={cn("text-2xs", over && "text-danger-ink")}
                  data-testid="note-count"
                >
                  {noteCountLabel(note)}
                </DataText>
                <span className="flex-1" />
                <Button variant="primary" size="sm" disabled={stars === null || busy || over} onClick={() => void submit()}>
                  {busy ? "Posting…" : online ? "Post" : "Hold until online"}
                </Button>
              </div>
              {!online && (
                <Text variant="secondary" className="text-warning-ink">
                  You are offline — this will be held on your device and posted when you reconnect.
                </Text>
              )}
            </>
          )}
          {error !== null && (
            <Text variant="secondary" className="text-danger-ink" role="alert">
              {error}
            </Text>
          )}
        </div>
      )}

      {data === null && reviews.loadFailed ? (
        <div className="flex flex-wrap items-center gap-2">
          <Text variant="secondary">The reviews could not be read.</Text>
          <Button variant="secondary" size="sm" onClick={reviews.reload}>
            Try again
          </Button>
        </div>
      ) : data !== null && rows.length === 0 ? (
        <Text
          variant="secondary"
          className="rounded-lg border border-dashed border-border-strong p-4.5 text-pretty"
          data-testid="reviews-empty"
        >
          No one has rated this day yet. If you run it, come back and say how it went — that is the only thing
          this list is built on.
        </Text>
      ) : (
        <ul className="flex flex-col" data-testid="review-list">
          {rows.map((row) => (
            <li
              key={row.key}
              className="flex gap-3 border-t border-hairline py-3"
              data-testid="review-row"
            >
              <span
                aria-hidden
                className="grid size-8.5 shrink-0 place-items-center rounded-full bg-moss font-mono text-xs font-semibold text-ink"
              >
                {row.who === "You" ? "You" : initialsFor(row.who)}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Text as="span" className="text-sm font-semibold">
                    {row.who}
                  </Text>
                  <Stars value={row.stars} label={starsPhrase(row.stars)} className="text-xs" />
                  <DataText size="xs" className="text-2xs">
                    {row.when}
                  </DataText>
                  {row.badge !== null && (
                    <Badge variant={row.badge === "Queued" ? "warning" : "brand"}>{row.badge}</Badge>
                  )}
                  {row.reviewerId !== null && (
                    <span className="ml-auto">
                      <ReportAction
                        target={{ kind: "review", savedDayId, reviewerId: row.reviewerId }}
                        name={`${row.who}'s review`}
                      />
                    </span>
                  )}
                </div>
                {row.note !== null && <Text className="text-pretty">{row.note}</Text>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * §15's conflict state: a held review's flush found the day republished since
 * the review was written, so it has NOT posted. Names who changed it and when —
 * which is all the server's 409 says; it does not say what changed, so this
 * does not claim to (the artboard's "the ferry time and two stops" is fixture
 * copy). The review stays held until the reader decides.
 */
export function ReviewConflictBanner({ reviews }: { reviews: DayReviews }) {
  const { conflict, held, busy } = reviews;
  if (conflict === null || held === null) return null;
  const when = formatRelativeInstant(conflict.changedAt) ?? "recently";
  return (
    <Banner
      variant="warning"
      data-testid="review-conflict"
      actions={
        <>
          <Button variant="primary" size="sm" disabled={busy} onClick={() => void reviews.postAnyway()}>
            Post it anyway
          </Button>
          <Button variant="secondary" size="sm" disabled={busy} onClick={reviews.discardHeld}>
            Discard it
          </Button>
        </>
      }
    >
      {conflict.authorDisplayName} changed this day {when}, after you wrote your review. Read it again — your{" "}
      {held.stars}-star review has not posted.
    </Banner>
  );
}
