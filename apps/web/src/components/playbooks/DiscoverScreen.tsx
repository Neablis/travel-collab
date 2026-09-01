"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Heading } from "@/components/ui/heading";
import { NativeSelect } from "@/components/ui/native-select";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Text } from "@/components/ui/text";
import { formatMoney } from "@/components/lenses/formatMoney";
import { searchPlaybooks } from "@/lib/apiClient";
import {
  BUDGET_BAND_EDGES,
  SEASON_LABELS,
  Season,
  type BudgetBand,
  type DiscoverResponse,
  type DiscoverScope,
  type DiscoverSort,
} from "@/lib/playbooks";
import { CitySearch } from "./CitySearch";
import { DiscoverCard } from "./DiscoverCard";
import { LibraryMoved, SyncFailure } from "./ReadStates";
import { useLibraryRead } from "./useLibraryRead";

// Discover (M11b link 5) — the route that REPLACES the inert `/playbooks`
// shell, not one that re-points it.
//
// Three things here are deliberate and are not to be "fixed" back to
// `SPEC.md` §15, which asks for more of each:
//
//   * **Two sorts, not four.** `highest-rated` and `most-reviewed` need the
//     reviews table M12 owns.
//   * **Three filters, not four.** No rating floor, for the milestone's own
//     stated reason: a control over data that does not exist is a control that
//     does nothing (project rule 2), and a number the product cannot stand
//     behind.
//   * **`Everyone / Yours / Saved` is a scope segment, not a second page.**
//     Your own library is a filter here (§15's R5).

const SCOPES: readonly { value: DiscoverScope; label: string }[] = [
  { value: "everyone", label: "Everyone" },
  { value: "yours", label: "Yours" },
  { value: "saved", label: "Saved" },
];

const SORTS: readonly { value: DiscoverSort; label: string }[] = [
  { value: "most-added", label: "Most added" },
  { value: "newest", label: "Newest" },
];

// The season options, in calendar order rather than enum order — a dropdown
// that reads Spring/Summer/Fall/Winter is a dropdown nobody has to think about.
const SEASONS: readonly Season[] = ["spring", "summer", "fall", "winter"];

/** How many skeleton cards stand in while the first read is in flight. */
const SKELETON_COUNT = 6;

type Filters = {
  cities: string[];
  scope: DiscoverScope;
  sort: DiscoverSort;
  budget: BudgetBand;
  season: Season | null;
};

const NO_FILTERS: Filters = {
  cities: [],
  scope: "everyone",
  sort: "most-added",
  budget: "any",
  season: null,
};

/**
 * `initialCities` comes from the URL — a profile's "Knows" chip is a link to
 * `/playbooks?city=Kyoto`, because §15 wants a profile to be a way INTO the
 * library rather than a dead end. It seeds state once rather than controlling
 * it: the chips above are editable from here on, and a URL that kept
 * overwriting them would fight the person using them.
 */
export function DiscoverScreen({ initialCities = [] }: { initialCities?: readonly string[] }) {
  const [filters, setFilters] = useState<Filters>({ ...NO_FILTERS, cities: [...initialCities] });
  const { cities, scope, sort, budget, season } = filters;

  const read = useCallback(
    () => searchPlaybooks({ cities, scope, sort, budget, season }),
    [cities, scope, sort, budget, season],
  );
  // The conflict signal is the DAY LIST plus each day's adds — the two things a
  // reader is looking at that somebody else can move. Deliberately not the
  // whole payload: sibling chip counts shift constantly and a banner that fired
  // on those would be a banner everybody learns to ignore.
  const signature = useCallback(
    (value: DiscoverResponse) => value.days.map((d) => `${d.savedDayId}:${d.adds}`).join(","),
    [],
  );
  const feed = useLibraryRead(read, signature);

  const set = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    setFilters((prev) => ({ ...prev, [key]: value }));

  const budgetOptions = useMemo(() => {
    const currency = feed.data?.budgetCurrency;
    // The bands hide rather than compare numbers that are not comparable — see
    // `BudgetBand`. ADR-008 makes currency trip-level, so a mixed result set is
    // not reachable through the product's own write path, but a control that
    // silently compared JPY to USD would be worse than an absent one.
    if (!currency) return null;
    const lower = formatMoney(BUDGET_BAND_EDGES.lower, currency);
    const upper = formatMoney(BUDGET_BAND_EDGES.upper, currency);
    // "Budget", not "Budget each" — the trailing "each" was on the control's
    // label AND on every option, saying the same thing twice on one dropdown
    // (Mitchell, 2026-09-01). The per-person reading survives on the card and
    // on the shared-day rail, which is where a number needs the qualifier.
    return [
      { value: "any" as const, label: "Any budget" },
      { value: "under" as const, label: `Under ${lower}` },
      { value: "mid" as const, label: `${lower} – ${upper}` },
      { value: "over" as const, label: `Over ${upper}` },
    ];
  }, [feed.data?.budgetCurrency]);

  const days = feed.data?.days ?? [];
  const siblings = feed.data?.siblings ?? [];

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Heading level={1}>Discover</Heading>
        <Text variant="secondary" className="mt-1.5 max-w-2xl">
          One good day, saved on its own — the stops, the order, the timings, the notes. Search a
          city, take a day into your trip, and the times reflow around it.
        </Text>
      </div>

      <SyncFailure read={feed} what="the library" />
      <LibraryMoved read={feed}>
        These days changed while you were looking — somebody published, withdrew or took one.
      </LibraryMoved>

      <CitySearch
        selected={cities}
        onAdd={(city) => set("cities", cities.includes(city) ? cities : [...cities, city])}
        onRemove={(city) => set("cities", cities.filter((c) => c !== city))}
      />

      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl
          value={scope}
          onValueChange={(value) => set("scope", value)}
          options={SCOPES}
          aria-label="Whose days"
        />
        <div className="flex-1" />
        <NativeSelect
          aria-label="Sort"
          value={sort}
          onChange={(e) => set("sort", e.target.value as DiscoverSort)}
        >
          {SORTS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </NativeSelect>
        {budgetOptions !== null && (
          <NativeSelect
            aria-label="Budget"
            value={budget}
            onChange={(e) => set("budget", e.target.value as BudgetBand)}
          >
            {budgetOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
        )}
        {/* Season, bucketed from the day's month — Mitchell, 2026-09-01, in
            place of the twelve-entry "Kept in <month>" dropdown that stood
            here. Twelve options over a library of a few dozen days meant most
            of them returned nothing; four buckets are a filter somebody can
            actually land on. The month behind the bucket is still what a day
            carries (`created_at`, the month it was lifted out of its source
            trip) and the shared-day rail still names it — see `Season` in
            lib/playbooks.ts for why there is no column. */}
        <NativeSelect
          aria-label="Season"
          value={season ?? ""}
          onChange={(e) => set("season", e.target.value === "" ? null : Season.parse(e.target.value))}
        >
          <option value="">Any season</option>
          {SEASONS.map((value) => (
            <option key={value} value={value}>
              {SEASON_LABELS[value]}
            </option>
          ))}
        </NativeSelect>
      </div>

      {/* Sibling chips when a query is on, the "busy right now" row when it is
          not. One row, because it is one question with and without a
          subtraction — see `siblingCities` on the server. */}
      {siblings.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" data-testid="sibling-cities">
          <Text as="span" variant="muted" className="text-xs">
            {cities.length === 0 ? "Busy right now" : "Also in these results"}
          </Text>
          {siblings.map((sibling) => (
            <Button
              key={sibling.city}
              type="button"
              variant="secondary"
              size="sm"
              className="rounded-full"
              aria-label={`Add ${sibling.city}`}
              onClick={() => set("cities", [...cities, sibling.city])}
            >
              {sibling.city} · {sibling.days}
            </Button>
          ))}
        </div>
      )}

      {feed.data?.truncated === true && (
        <Text variant="muted" className="text-xs">
          Showing the best matches. Narrow the cities to see the rest.
        </Text>
      )}

      {/* Skeleton grid while fetching — and only on the FIRST fetch. A later
          read (a filter change, a Retry) leaves the previous results in place
          rather than flashing the page empty, which is what makes changing a
          filter feel like a filter rather than a navigation. */}
      {feed.loading && feed.data === null ? (
        <ul className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3" data-testid="discover-skeleton">
          {Array.from({ length: SKELETON_COUNT }, (_, i) => (
            <Card key={i} as="li" className="h-44 animate-pulse rounded-lg bg-moss" aria-hidden />
          ))}
        </ul>
      ) : days.length === 0 ? (
        /* One way out, not two. "Drop the filters" and "Search everywhere" did
           the identical thing — both reset to `NO_FILTERS` — and the first was
           disabled exactly when this empty state was unreachable anyway, so it
           read as a dead control beside a live one (Mitchell, 2026-09-01:
           "Drop the filters is a bad experience, drop that button all
           together"). */
        <EmptyState
          title={feed.error !== null ? "Nothing to show yet" : "No days match"}
          body={
            scope === "saved"
              ? "Days you take into a trip show up here. Nothing yet."
              : "Nothing in the library matches all of these at once."
          }
          action={
            <Button variant="primary" onClick={() => setFilters({ ...NO_FILTERS, sort })}>
              Search everywhere
            </Button>
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3" data-testid="discover-results">
          {days.map((day) => (
            <DiscoverCard key={day.savedDayId} day={day} origin={{ from: "playbooks" }} />
          ))}
        </ul>
      )}

      {/* The leaderboard's ONLY entrance. Not in the top bar: it is
          trip-independent but not account scope, so project rule 1 puts it
          here rather than in the chrome.

          Withheld while the library holds nothing published: "who shares the
          most" over nobody sharing anything is a link to an empty ranking
          (Mitchell, 2026-09-01). Keyed on `sharedDayCount`, which ignores every
          filter on this query — so a Hakone search that matches nothing does
          not take the link away, only an empty library does. Absent until the
          first read lands, rather than flashing in and out: `feed.data` is null
          then, and a link that appears and vanishes is worse than one that
          arrives a beat late. */}
      {(feed.data?.sharedDayCount ?? 0) > 0 && (
        <div className="border-t border-hairline pt-4">
          <Link href="/playbooks/board" className="text-sm font-semibold text-brand hover:underline">
            Who shares the most →
          </Link>
        </div>
      )}
    </div>
  );
}
