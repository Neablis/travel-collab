"use client";

import Link from "next/link";
import { useCallback } from "react";
import { Card } from "@/components/ui/card";
import { DataText } from "@/components/ui/data-text";
import { EmptyState } from "@/components/ui/empty-state";
import { Heading } from "@/components/ui/heading";
import { Text } from "@/components/ui/text";
import { fetchPublicProfile } from "@/lib/apiClient";
import { displayNameFor } from "@/lib/displayName";
import type { PublicProfileResponse } from "@/lib/playbooks";
import { DiscoverCard } from "./DiscoverCard";
import { LibraryMoved, SyncFailure } from "./ReadStates";
import { useLibraryRead } from "./useLibraryRead";
import type { BackTarget } from "./backLink";

// A public profile (M11b link 8).
//
// **Derived, never authored.** Every number on this page is computed from that
// person's days, so a profile can never disagree with Discover — and the cards
// below ARE Discover cards, produced by the same endpoint and rendered by the
// same component, which is what turns that from a promise into a property.
//
// No bio, no follow, no avatar, and **no public user record**: §15 is explicit
// that a profile answers "is this person worth taking a day from" and nothing
// else. Adding a record to hold a name would be building M17's half of the
// display-name seam here, in the one place the milestone says not to.
//
// No average rating and no reviews-received count either — those are M12's,
// with the reviews table that would give them a meaning.

const SKELETON_COUNT = 3;

export function ProfileScreen({ userId, back }: { userId: string; back: BackTarget }) {
  const read = useCallback(() => fetchPublicProfile(userId), [userId]);
  const signature = useCallback(
    (value: PublicProfileResponse) =>
      `${value.author.daysShared}:${value.author.adds}:${value.days.map((d) => d.savedDayId).join(",")}`,
    [],
  );
  const feed = useLibraryRead(read, signature);

  return (
    <div className="flex flex-col gap-4">
      <Link href={back.href} className="w-fit text-sm text-slate hover:underline">
        ← {back.label}
      </Link>

      <SyncFailure read={feed} what="this profile" />
      <LibraryMoved read={feed}>
        These numbers changed while you were looking — a day was published, withdrawn or taken.
      </LibraryMoved>

      {feed.data === null ? (
        <Card className="h-32 animate-pulse rounded-lg bg-moss" aria-hidden data-testid="profile-skeleton" />
      ) : (
        <>
          <div>
            {/* The M17 seam, second and last call site — one resolver, and it
                returns the identifier today. */}
            <Heading level={1}>{displayNameFor({ userId: feed.data.author.userId })}</Heading>
            <Text variant="secondary" className="mt-1">
              Every number here is counted from this person&apos;s days, so it says the same thing
              as Discover does.
            </Text>
          </div>

          <Card className="flex flex-wrap gap-6 p-4" data-testid="profile-numbers">
            <Number label="Days shared" value={feed.data.author.daysShared} />
            <Number label="Added to trips" value={feed.data.author.adds} />
            <Number label="Cities" value={feed.data.knows.length} />
          </Card>

          {feed.data.knows.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5" data-testid="knows-cities">
              <Text as="span" variant="muted" className="text-xs">
                Knows
              </Text>
              {feed.data.knows.map((city) => (
                // A way INTO the library rather than a dead end (§15): the chip
                // is a Discover search scoped to that city, which is why it is a
                // link with a real href rather than a filter this page applies
                // to its own list.
                <Link
                  key={city.city}
                  href={`/playbooks?city=${encodeURIComponent(city.city)}`}
                  className="rounded-full border border-hairline bg-surface px-2.5 py-0.5 text-xs font-semibold text-slate hover:bg-moss"
                >
                  {city.city} · {city.days}
                </Link>
              ))}
            </div>
          )}

          {feed.data.days.length === 0 ? (
            <EmptyState
              title="Nothing shared yet"
              body="This person has not published any days. A private day never appears here — not even to its own author."
            />
          ) : (
            <ul className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3" data-testid="profile-days">
              {feed.data.days.map((day) => (
                <DiscoverCard key={day.savedDayId} day={day} />
              ))}
            </ul>
          )}
        </>
      )}

      {feed.data === null && (
        <ul className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3" aria-hidden>
          {Array.from({ length: SKELETON_COUNT }, (_, i) => (
            <Card key={i} as="li" className="h-40 animate-pulse rounded-lg bg-moss" />
          ))}
        </ul>
      )}
    </div>
  );
}

function Number({ label, value }: { label: string; value: number }) {
  return (
    <div data-testid={`profile-number-${label.toLowerCase().replace(/ /g, "-")}`}>
      <DataText size="base" className="block text-ink">
        {value}
      </DataText>
      <Text as="span" variant="muted" className="text-xs uppercase tracking-wide">
        {label}
      </Text>
    </div>
  );
}
