"use client";

import Link from "next/link";
import { Heading } from "@/components/ui/heading";
import { Text } from "@/components/ui/text";
import type { DiscoverDay } from "@/lib/playbooks";
import { PLACE_PAGE_SIZE, placePagePath } from "@/lib/playbookUrls";
import { DiscoverCard } from "./DiscoverCard";

// A client component fed the server's rows: `DiscoverCard` reads the reader's
// clock preference through a hook.
/**
 * A city or country page's body: its heading, how many days, the cards, and
 * the pager. The pager is real links (`?page=N`), because a crawler reaches
 * page two by following one.
 */
export function PlaceDaysList({
  name,
  path,
  days,
  total,
  page,
}: {
  name: string;
  /** The place's own path, page one. */
  path: string;
  days: DiscoverDay[];
  total: number;
  page: number;
}) {
  const lastPage = Math.max(1, Math.ceil(total / PLACE_PAGE_SIZE));
  return (
    <div className="flex flex-col gap-4">
      <Link href="/playbooks" className="w-fit text-sm text-slate hover:underline">
        ← Discover
      </Link>
      <div>
        {/* One string, not `{name} playbooks`: two text nodes reach the HTML
            split by a comment, and the heading is what a crawler reads. */}
        <Heading level={1}>{`${name} playbooks`}</Heading>
        <Text variant="secondary">
          {total === 1 ? `1 day a traveler planned in ${name}.` : `${total} days other travelers planned in ${name}.`}
        </Text>
      </div>
      <ul className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3" data-testid="place-days">
        {days.map((day) => (
          <DiscoverCard key={day.savedDayId} day={day} origin={{ from: "playbooks" }} />
        ))}
      </ul>
      {lastPage > 1 && (
        <nav aria-label="Pages" className="flex items-center gap-4 text-sm">
          {page > 1 && (
            <Link href={placePagePath(path, page - 1)} rel="prev" className="underline">
              Previous
            </Link>
          )}
          <Text variant="secondary">{`Page ${page} of ${lastPage}`}</Text>
          {page < lastPage && (
            <Link href={placePagePath(path, page + 1)} rel="next" className="underline">
              Next
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
