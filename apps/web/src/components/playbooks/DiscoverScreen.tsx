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

// 1-12 against `Date`'s 0-11, which is the off-by-one this label list exists to
// keep in one place.
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/** How many skeleton cards stand in while the first read is in flight. */
const SKELETON_COUNT = 6;

type Filters = {
  cities: string[];
  scope: DiscoverScope;
  sort: DiscoverSort;
  budget: BudgetBand;
  month: number | null;
};

const NO_FILTERS: Filters = {
  cities: [],
  scope: "everyone",
  sort: "most-added",
  budget: "any",
  month: null,
};

function isFiltered(f: Filters): boolean {
  return f.cities.length > 0 || f.budget !== "any" || f.month !== null || f.scope !== "everyone";
}

/**
 * `initialCities` comes from the URL — a profile's "Knows" chip is a link to
 * `/playbooks?city=Kyoto`, because §15 wants a profile to be a way INTO the
 * library rather than a dead end. It seeds state once rather than controlling
 * it: the chips above are editable from here on, and a URL that kept
 * overwriting them would fight the person using them.
 */
export function DiscoverScreen({ initialCities = [] }: { initialCities?: readonly string[] }) {
  const [filters, setFilters] = useState<Filters>({ ...NO_FILTERS, cities: [...initialCities] });
  const { cities, scope, sort, budget, month } = filters;

  const read = useCallback(
    () => searchPlaybooks({ cities, scope, sort, budget, month }),
    [cities, scope, sort, budget, month],
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
    return [
      { value: "any" as const, label: "Any budget" },
      { value: "under" as const, label: `Under ${lower} each` },
      { value: "mid" as const, label: `${lower} – ${upper} each` },
      { value: "over" as const, label: `Over ${upper} each` },
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
            aria-label="Budget each"
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
        {/* "Kept in", not "run in" — and that wording is load-bearing. §15 asks
            to filter on "the month it was run", which a saved day cannot
            answer: `stopsForDay` drops the calendar date on purpose (ADR-029,
            "keeping it would make a saved day only reusable in June"), so the
            only month a day carries is the month it entered the library. The
            control filters on real data and says which data it is, rather than
            claiming a month the contract deliberately does not store. */}
        <NativeSelect
          aria-label="Kept in"
          value={month === null ? "" : String(month)}
          onChange={(e) => set("month", e.target.value === "" ? null : Number(e.target.value))}
        >
          <option value="">Kept any month</option>
          {MONTHS.map((label, index) => (
            <option key={label} value={index + 1}>
              Kept in {label}
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
        <EmptyState
          title={feed.error !== null ? "Nothing to show yet" : "No days match"}
          body={
            scope === "saved"
              ? "Days you take into a trip show up here. Nothing yet."
              : "Nothing in the library matches all of these at once."
          }
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="secondary" onClick={() => setFilters(NO_FILTERS)} disabled={!isFiltered(filters)}>
                Drop the filters
              </Button>
              <Button
                variant="primary"
                onClick={() => setFilters({ ...NO_FILTERS, sort })}
              >
                Search everywhere
              </Button>
            </div>
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3" data-testid="discover-results">
          {days.map((day) => (
            <DiscoverCard key={day.savedDayId} day={day} />
          ))}
        </ul>
      )}

      {/* The leaderboard's ONLY entrance. Not in the top bar: it is
          trip-independent but not account scope, so project rule 1 puts it
          here rather than in the chrome. */}
      <div className="border-t border-hairline pt-4">
        <Link href="/playbooks/board" className="text-sm font-semibold text-brand hover:underline">
          Who shares the most →
        </Link>
      </div>
    </div>
  );
}
