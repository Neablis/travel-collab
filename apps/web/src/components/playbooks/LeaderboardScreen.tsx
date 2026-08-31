"use client";

import Link from "next/link";
import { useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";
import { DataText } from "@/components/ui/data-text";
import { EmptyState } from "@/components/ui/empty-state";
import { Heading } from "@/components/ui/heading";
import { Text } from "@/components/ui/text";
import { fetchLeaderboard } from "@/lib/apiClient";
import { displayNameFor } from "@/lib/displayName";
import type { LeaderboardResponse } from "@/lib/playbooks";
import { cn } from "@/lib/cn";
import { backQuery } from "./backLink";
import { LibraryMoved, SyncFailure } from "./ReadStates";
import { useLibraryRead } from "./useLibraryRead";

// The leaderboard (M11b link 7).
//
// **Not in the top bar.** It is trip-independent but not account scope, so
// project rule 1 puts its only entrance on Discover ("Who shares the most").
// If a link to this appears in the chrome, that rule has been broken.
//
// **No empty state**, and that is §15's call rather than an omission: the board
// cannot be empty while any day is shared, so a designed empty state here would
// be a screen nobody can reach. The exit gate excuses it explicitly.

/** The ranking rule, in the page's own copy. §15 requires it stated. */
const RULE =
  "An add only counts once per trip, and only after the trip has dates. Copying your own day into your own trip does not count.";

const SKELETON_ROWS = 5;

export function LeaderboardScreen() {
  const read = useCallback(() => fetchLeaderboard(), []);
  const signature = useCallback(
    // `daysShared` is in the signature because the row RENDERS it: publishing or
    // withdrawing a day moves it without moving `adds`, and a board that
    // refreshed under a reader without raising `LibraryMoved` is the thing this
    // signature exists to prevent. Raised by review on pull request 102.
    (value: LeaderboardResponse) =>
      value.authors.map((a) => `${a.userId}:${a.daysShared}:${a.adds}`).join(","),
    [],
  );
  const feed = useLibraryRead(read, signature);

  return (
    <div className="flex flex-col gap-4">
      <Link href="/playbooks" className="w-fit text-sm text-slate hover:underline">
        ← Discover
      </Link>

      <div>
        <Heading level={1}>Who shares the most</Heading>
        {/* The rule, in copy, on the page. It is the whole credibility of the
            ranking: a build that counted raw inserts would produce a different
            and gameable order, and a reader has no way to tell which one they
            are looking at unless the page says. */}
        <Text variant="secondary" className="mt-1.5 max-w-2xl">
          Ranked on days other people actually took into a trip. {RULE}
        </Text>
      </div>

      <SyncFailure read={feed} what="the board" />
      <LibraryMoved read={feed}>The board has moved since you opened it.</LibraryMoved>

      {/* Gated on `loading`, not on `data === null` alone: a first read that
          FAILS leaves both null and false, and the board used to pulse skeleton
          rows forever under its own sync banner (CodeRabbit, PR 102). */}
      {feed.loading && feed.data === null ? (
        <ul className="flex flex-col gap-2" data-testid="board-skeleton">
          {Array.from({ length: SKELETON_ROWS }, (_, i) => (
            <Card key={i} as="li" className="h-14 animate-pulse rounded-lg bg-moss" aria-hidden />
          ))}
        </ul>
      ) : feed.data === null ? (
        // Not the §15 "no empty state" case — that rules out a board with no
        // ROWS, which cannot happen. This is a board that never arrived, and
        // the Retry for it is in the banner above.
        <EmptyState
          title="The board could not be loaded"
          body="Nothing has been shown yet. Retry above, or go back to Discover."
        />
      ) : (
        <ol className="flex flex-col gap-2" data-testid="board-rows">
          {feed.data.authors.map((author, index) => {
            const isMe = author.userId === feed.data!.meUserId;
            return (
              <Card
                as="li"
                key={author.userId}
                data-testid="board-row"
                data-user-id={author.userId}
                data-me={isMe}
                // Tinted and badged, never lifted: the row stays exactly where
                // the ledger put it. A board that floated your own row to the
                // top would be answering a different question than the one it
                // states in its own copy.
                className={cn("flex items-center gap-3 p-3", isMe && "bg-brand-tint")}
              >
                <DataText size="sm" className="w-8 shrink-0">
                  {index + 1}
                </DataText>
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/playbooks/profile/${encodeURIComponent(author.userId)}${backQuery({ from: "board" })}`}
                    className="font-semibold text-ink hover:underline"
                  >
                    {displayNameFor({ userId: author.userId })}
                  </Link>
                  <Text variant="secondary">
                    {author.daysShared} day{author.daysShared === 1 ? "" : "s"} shared
                  </Text>
                </div>
                {isMe && <Badge variant="brand">You</Badge>}
                <DataText size="sm">
                  {author.adds} add{author.adds === 1 ? "" : "s"}
                </DataText>
              </Card>
            );
          })}
        </ol>
      )}

      {/* Not an empty state — a note about what the number is not. It is here
          because "0 adds" beside a person who has shared days reads as a
          judgement, and the rule above is what actually explains it. */}
      <Banner variant="info">
        Sharing a day is not what ranks you here — being taken into somebody else&apos;s dated trip
        is.
      </Banner>
    </div>
  );
}
