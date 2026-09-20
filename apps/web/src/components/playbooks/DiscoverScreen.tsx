"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Heading } from "@/components/ui/heading";
import { Popover } from "@/components/ui/popover";
import { Sheet } from "@/components/ui/sheet";
import { Text } from "@/components/ui/text";
import { UnderlineTabs } from "@/components/ui/underline-tabs";
import { cn } from "@/lib/cn";
import { searchPlaybooks } from "@/lib/apiClient";
import type {
  BudgetBand,
  DiscoverResponse,
  DiscoverScope,
  DiscoverSort,
  LengthBand,
} from "@/lib/playbooks";
import {
  FILTER_DEFS,
  activeFilterCount,
  chipLabel,
  clearedFilters,
  isFilterSet,
  moreFilters,
  rowFilters,
  type FilterDef,
  type FilterOption,
  type FilterState,
} from "./discoverFilters";
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

/** How many skeleton cards stand in while the first read is in flight. */
const SKELETON_COUNT = 6;

type Filters = {
  cities: string[];
  scope: DiscoverScope;
  sort: DiscoverSort;
  budget: BudgetBand;
  length: LengthBand;
};

const NO_FILTERS: Filters = {
  cities: [],
  scope: "everyone",
  sort: "most-added",
  budget: "any",
  length: "any",
};

/**
 * `initialCities` comes from the URL — a profile's "Knows" chip is a link to
 * `/playbooks?city=Kyoto`, because §15 wants a profile to be a way INTO the
 * library rather than a dead end. It seeds state once rather than controlling
 * it: the chips above are editable from here on, and a URL that kept
 * overwriting them would fight the person using them.
 */
/**
 * A face chip's menu: one row per option, the current one ticked.
 *
 * A list of buttons rather than a `NativeSelect` inside a popover — project
 * rule 3 bans a select inside a popover that itself opens from a menu, and the
 * artboard draws rows with a tick column.
 */
function FilterMenu({
  def,
  options,
  current,
  onPick,
}: {
  def: FilterDef;
  options: readonly FilterOption[];
  current: string;
  onPick: (value: string) => void;
}) {
  return (
    <div className="flex flex-col">
      {options.map((option) => {
        const on = option.value === current;
        return (
          <Button
            key={option.value}
            type="button"
            variant="ghost"
            size="sm"
            aria-pressed={on}
            data-testid={`filter-${def.id}-${option.value}`}
            className="h-auto justify-start gap-2 rounded-md px-2.5 py-2 text-sm font-normal"
            onClick={() => onPick(option.value)}
          >
            <span aria-hidden className="w-3.5 text-brand">
              {on ? "✓" : ""}
            </span>
            <span className={on ? "font-semibold" : undefined}>{option.label}</span>
          </Button>
        );
      })}
    </div>
  );
}

export function DiscoverScreen({ initialCities = [] }: { initialCities?: readonly string[] }) {
  const [filters, setFilters] = useState<Filters>({ ...NO_FILTERS, cities: [...initialCities] });
  const { cities, scope, sort, budget, length } = filters;
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [phoneFiltersOpen, setPhoneFiltersOpen] = useState(false);

  const read = useCallback(
    () => searchPlaybooks({ cities, scope, sort, budget, length }),
    [cities, scope, sort, budget, length],
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

  // Each filter's own options, resolved once against the current context. A
  // `null` means the filter cannot honestly be offered — Budget with no shared
  // currency — and it then appears nowhere: not as a chip, not in *More
  // filters*, and not in the count.
  const filterOptions = useMemo(() => {
    const ctx = { budgetCurrency: feed.data?.budgetCurrency ?? null };
    return new Map(FILTER_DEFS.map((def) => [def.id, def.options(ctx)] as const));
  }, [feed.data?.budgetCurrency]);

  const offerable = useCallback(
    (def: FilterDef): readonly FilterOption[] | null => filterOptions.get(def.id) ?? null,
    [filterOptions],
  );

  // **A filter the context cannot offer is cleared from STATE, not merely
  // hidden.** The comment above says an unofferable filter "appears nowhere:
  // not as a chip, not in *More filters*, and not in the count" — but only the
  // controls honoured that. A budget chosen while Kyoto's results shared a
  // currency stayed in `filters` after a scope change removed that shared
  // currency: still counted, still sent to `searchPlaybooks`, and with no
  // control left to see or clear it. Results were narrowed by something the
  // reader could not find (CodeRabbit, PR 196).
  //
  // **Clearing is safe to do from the feed's own answer**, which is the part
  // worth checking before writing this: `budgetCurrency` is computed in
  // `server/playbooks.ts` over the CANDIDATES, before the budget predicate is
  // applied. So it does not depend on the budget value, and clearing the budget
  // cannot change the currency that caused the clear. No oscillation.
  useEffect(() => {
    setFilters((prev) => {
      const cleared = FILTER_DEFS.reduce(
        (acc, def) => (filterOptions.get(def.id) == null ? def.apply(acc, def.none) : acc),
        { budget: prev.budget, length: prev.length } as FilterState,
      );
      // Returning `prev` unchanged is what keeps this effect from looping:
      // `def.apply` always builds a new object, so an identity comparison would
      // re-set state on every render.
      if (cleared.budget === prev.budget && cleared.length === prev.length) return prev;
      return { ...prev, ...cleared };
    });
  }, [filterOptions]);

  const questions: FilterState = { budget, length };
  const activeCount = activeFilterCount(questions);

  const setQuestion = (def: FilterDef, value: string) =>
    setFilters((prev) => ({ ...prev, ...def.apply({ budget: prev.budget, length: prev.length }, value) }));

  const days = feed.data?.days ?? [];
  const siblings = feed.data?.siblings ?? [];

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Heading level={1}>Discover</Heading>
        <Text variant="secondary" className="mt-1.5 max-w-2xl">
          {/* Was "One good day, saved on its own ... take a day into your
              trip". True until M23, when a Playbook became a SEQUENCE — and a
              header promising one day above a card reading "3 days" is the
              first thing a reader would disbelieve. */}
          A day or a whole run of them, saved together — the stops, the order, the timings, the
          notes. Search a city, take a playbook into your trip, and the times reflow around it.
        </Text>
      </div>

      <SyncFailure read={feed} what="the library" />
      <LibraryMoved read={feed}>
        These days changed while you were looking — somebody published, withdrew or took one.
      </LibraryMoved>

      {/* §33.2: **a place is a tab, above the search.** It was a
          `SegmentedControl` below it — a pill, which is what a FILTER looks
          like on this page, so the one control that changes which set you are
          looking at wore the clothes of the ones that narrow it.

          **Sticky on a phone** (§16): the tabs and the search card are how you
          change what the list is, and a one-column list of cards is long enough
          that scrolling into it otherwise strands you with no way to change the
          query but to scroll back. `bg-paper` so the list does not show through
          it, and `-mx-6 px-6` to bleed the background to the page edges while
          the content keeps `PageContainer`'s gutter. Not sticky from `md` up,
          where the whole header is on screen at once. */}
      <div className="sticky top-0 z-10 -mx-6 flex flex-col gap-5 bg-paper px-6 pt-1 pb-1 md:static md:mx-0 md:px-0 md:pt-0 md:pb-0">
      <UnderlineTabs
        value={scope}
        onValueChange={(value) => set("scope", value)}
        options={SCOPES}
        idPrefix="discover-scope"
        aria-label="Whose days"
      />

      <CitySearch
        selected={cities}
        onAdd={(city) => set("cities", cities.includes(city) ? cities : [...cities, city])}
        onRemove={(city) => set("cities", cities.filter((c) => c !== city))}
      />
      </div>

      {/* §33.2: **the filter row is chips, and one *More filters* menu.** The
          three `NativeSelect`s that stood here read as three of a kind while
          being three different kinds of decision. */}
      {/* **The desktop row: chips and a *More filters* popover.** Hidden below
          `md`, where project rule 3 forbids this shape outright — a popover
          opening from a row of popovers, on a screen where each one covers the
          list it is filtering. The phone gets ONE sheet instead, below.

          Both are rendered and one is hidden by CSS rather than switched on
          `useIsPhone()`: that hook starts `false` on the server and on the
          first client paint by design, so a JS-gated filter row would show the
          desktop shape for one paint on a phone and then swap. They share one
          `filters` state, so there is no second source of truth — only a second
          set of controls over the same one. */}
      <div className="hidden flex-wrap items-center gap-2 md:flex" data-testid="discover-filters">
        {rowFilters(questions).map((def) => {
          const options = offerable(def);
          if (options === null) return null;
          const set = isFilterSet(def, questions);
          return (
            <Popover
              key={def.id}
              open={openMenu === def.id}
              onOpenChange={(open) => setOpenMenu(open ? def.id : null)}
              align="start"
              contentClassName="w-56 p-1"
              collisionPadding={12}
              trigger={
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  aria-label={def.label}
                  data-testid={`filter-chip-${def.id}`}
                  // §33.2: outline + slate when empty, `--color-brand-tint` +
                  // brand border **showing its value** when set. A chip that
                  // still reads "Budget" once a budget is chosen makes the
                  // reader open it to find out what they asked for.
                  className={cn(
                    "rounded-full",
                    set && "border-brand bg-brand-tint text-brand",
                  )}
                >
                  {chipLabel(def, questions, options)}
                </Button>
              }
            >
              <FilterMenu
                def={def}
                options={options}
                current={def.value(questions)}
                onPick={(value: string) => {
                  setQuestion(def, value);
                  setOpenMenu(null);
                }}
              />
            </Popover>
          );
        })}

        {/* Everything that is not a face filter, grouped by label. With Length
            as the only member today this is one group — the shape is what
            matters, because M12's rating filter lands in it. */}
        <Popover
          open={openMenu === "more"}
          onOpenChange={(open) => setOpenMenu(open ? "more" : null)}
          align="start"
          contentClassName="w-60 p-3"
          collisionPadding={12}
          trigger={
            <Button type="button" variant="ghost" size="sm" data-testid="filter-more">
              More filters
            </Button>
          }
        >
          <div className="flex flex-col gap-3.5">
            {moreFilters().map((def) => {
              const options = offerable(def);
              if (options === null) return null;
              return (
                <div key={def.id} className="flex flex-col gap-1.5">
                  <Text as="span" variant="muted" className="font-mono text-2xs tracking-wider uppercase">
                    {def.label}
                  </Text>
                  <div className="flex flex-wrap gap-1.5">
                    {options.map((option) => {
                      const on = def.value(questions) === option.value;
                      return (
                        <Button
                          key={option.value}
                          type="button"
                          variant="secondary"
                          size="sm"
                          aria-pressed={on}
                          data-testid={`filter-more-${def.id}-${option.value}`}
                          className={cn("rounded-full", on && "border-brand bg-brand-tint text-brand")}
                          onClick={() => setQuestion(def, option.value)}
                        >
                          {option.label}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </Popover>
      </div>

      {/* Sibling chips when a query is on, the "busy right now" row when it is
          not. One row, because it is one question with and without a
          subtraction — see `siblingCities` on the server.

          "Also in these RESULTS" is the load-bearing word, not filler. The
          count is days in the current result set — band included since
          KI-2026-08-31 — that also touch this city. It is NOT how many days
          the tap adds: city matching is containment, so adding a city widens
          the match and a tap can only ever return at least this many. Don't
          "improve" this to "Add N more"; that sentence is false in both
          directions. */}
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

      {/* §33.2: **the results sentence, which did not exist**, and it is where
          sort lives now. `128 shared days · Most added ▾`.

          **The sentence states the count only.** It used to end ", most added
          first" — beside a live Sort control that both duplicated it and could
          contradict it. */}
      {/* **The phone's whole filter surface: one button, one sheet** (§16,
          project rule 3). It carries filters AND sort — sort is a property of
          the list and belongs with the questions when there is only one place
          to put them — and **deliberately not scope**, which stays as the tabs
          above the search. A place is not a sheet setting.

          The count on the button is `activeFilterCount`, which excludes scope
          and sort: the phone badge used to count "sorted by newest" as a
          filter, which is the defect §33.2 names. */}
      <div className="md:hidden">
        <Button
          type="button"
          variant="secondary"
          size="touch"
          data-testid="discover-phone-filters"
          onClick={() => setPhoneFiltersOpen(true)}
        >
          Filters{activeCount > 0 ? ` (${activeCount})` : ""}
        </Button>
      </div>

      <Sheet
        open={phoneFiltersOpen}
        onOpenChange={setPhoneFiltersOpen}
        title="Filters"
        size="bottom"
      >
        <div className="flex flex-col gap-5 pb-2" data-testid="discover-filter-sheet">
          {FILTER_DEFS.map((def) => {
            const options = offerable(def);
            if (options === null) return null;
            return (
              <div key={def.id} className="flex flex-col gap-2">
                <Text as="span" variant="muted" className="font-mono text-2xs tracking-wider uppercase">
                  {def.label}
                </Text>
                <div className="flex flex-wrap gap-2">
                  {options.map((option) => {
                    const on = def.value(questions) === option.value;
                    return (
                      <Button
                        key={option.value}
                        type="button"
                        variant="secondary"
                        size="touch"
                        aria-pressed={on}
                        data-testid={`sheet-${def.id}-${option.value}`}
                        className={cn("rounded-full", on && "border-brand bg-brand-tint text-brand")}
                        onClick={() => setQuestion(def, option.value)}
                      >
                        {option.label}
                      </Button>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* Sort, in the sheet with the filters and NOT counted as one. */}
          <div className="flex flex-col gap-2">
            <Text as="span" variant="muted" className="font-mono text-2xs tracking-wider uppercase">
              Sort
            </Text>
            <div className="flex flex-wrap gap-2">
              {SORTS.map((option) => (
                <Button
                  key={option.value}
                  type="button"
                  variant="secondary"
                  size="touch"
                  aria-pressed={sort === option.value}
                  data-testid={`sheet-sort-${option.value}`}
                  className={cn("rounded-full", sort === option.value && "border-brand bg-brand-tint text-brand")}
                  onClick={() => set("sort", option.value)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </div>

          {activeCount > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="touch"
              data-testid="sheet-clear-filters"
              className="self-start text-brand"
              onClick={() => setFilters((prev) => ({ ...prev, ...clearedFilters(prev) }))}
            >
              Clear filters ({activeCount})
            </Button>
          )}
        </div>
      </Sheet>

      <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-2 border-t border-hairline pt-2">
        {feed.data !== null && (
          <Text as="span" className="text-sm text-ink" data-testid="discover-results-line">
            {feed.data.days.length} shared {feed.data.days.length === 1 ? "day" : "days"}
          </Text>
        )}
        <div className="hidden md:contents">
        <Popover
          open={openMenu === "sort"}
          onOpenChange={(open) => setOpenMenu(open ? "sort" : null)}
          align="start"
          contentClassName="w-56 p-1"
          collisionPadding={12}
          trigger={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Sort"
              data-testid="discover-sort"
              className="h-auto px-1 py-0 text-sm font-normal"
            >
              {SORTS.find((o) => o.value === sort)?.label} ▾
            </Button>
          }
        >
          <div className="flex flex-col">
            {SORTS.map((option) => (
              <Button
                key={option.value}
                type="button"
                variant="ghost"
                size="sm"
                aria-pressed={sort === option.value}
                data-testid={`discover-sort-${option.value}`}
                className="h-auto justify-start rounded-md px-2.5 py-2 text-sm font-normal"
                onClick={() => {
                  set("sort", option.value);
                  setOpenMenu(null);
                }}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </Popover>

        <div className="flex-1" />

        {/* **Clear filters drops the questions and nothing else** — not the
            scope, which is a place (§33.2), and not the sort, which is a
            property of the list. */}
        {activeCount > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="discover-clear-filters"
            className="h-auto px-1 py-0 text-sm font-normal text-brand underline"
            onClick={() => setFilters((prev) => ({ ...prev, ...clearedFilters(prev) }))}
          >
            Clear filters ({activeCount})
          </Button>
        )}
        </div>
      </div>

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
            // **Keeps the scope**, which `{ ...NO_FILTERS, sort }` did not:
            // it reset `scope` to `everyone`, so somebody looking at *Saved*
            // and finding nothing was moved to a different place without
            // asking. §33.2 forbids it — a place is never reset by a control
            // about questions. Cities go, because they are a question asked in
            // the search card.
            <Button
              variant="primary"
              onClick={() => setFilters({ ...NO_FILTERS, scope, sort })}
              data-testid="discover-search-everywhere"
            >
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
