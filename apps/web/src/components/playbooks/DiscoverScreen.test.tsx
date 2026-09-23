import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscoverDay, DiscoverResponse } from "@/lib/playbooks";

const searchPlaybooksMock = vi.fn();
const searchCitiesMock = vi.fn();
vi.mock("@/lib/apiClient", () => ({
  searchPlaybooks: (...args: unknown[]) => searchPlaybooksMock(...args),
  searchCities: (...args: unknown[]) => searchCitiesMock(...args),
}));

import { DiscoverScreen } from "./DiscoverScreen";
import { matchLine } from "./DiscoverCard";

function day(over: Partial<DiscoverDay> = {}): DiscoverDay {
  return {
    savedDayId: "aa000000-0000-4000-8000-000000000001",
    ownerId: "dev-alice",
    name: "Kyoto temples on foot",
    cities: ["Kyoto"],
    matchedCities: [],
    stopCount: 4,
    dayCount: 1,
    window: { start: "07:30", end: "18:30" },
    totalCost: { amountMinor: 2_700, currency: "USD" },
    adds: 2,
    visibility: "public",
    authorKind: "human",
    sourceTripName: "Japan",
    createdAt: "2026-08-01T00:00:00.000Z",
    publishedAt: "2026-08-02T00:00:00.000Z",
    isMine: false,
    ...over,
  };
}

function response(over: Partial<DiscoverResponse> = {}): DiscoverResponse {
  return { days: [day()], siblings: [], budgetCurrency: "USD", truncated: false, sharedDayCount: 1, ...over };
}

const ok = <T,>(value: T) => ({ ok: true as const, value });

/** A filter chip's words, without the trailing caret every chip carries (§35.5). */
const chipText = (el: HTMLElement) => el.textContent?.replace("▾", "");

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  searchPlaybooksMock.mockReset().mockResolvedValue(ok(response()));
  searchCitiesMock.mockReset().mockResolvedValue(ok([{ city: "Kyoto", days: 3 }]));
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

/** The debounce is 250ms; nothing reaches the endpoint before it elapses. */
async function typeCity(text: string): Promise<void> {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  await user.type(screen.getByLabelText("Search cities"), text);
  await vi.advanceTimersByTimeAsync(300);
}

describe("Discover", () => {
  it("asks the endpoint once the page mounts, and shows the cards", async () => {
    render(<DiscoverScreen />);
    // eslint-disable-next-line testing-library/prefer-find-by -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    await waitFor(() => expect(screen.getByTestId("discover-results")).toBeTruthy());
    expect(screen.getByText("Kyoto temples on foot")).toBeTruthy();
  });

  // ADR-041 decision 5: the library mixes days people kept out of their own
  // trips with generated starter content, and the card is where somebody
  // chooses between thirty of them. **Only "ai" renders** — "human" is the
  // absence of a claim, not a claim, and a mark on almost every card marks
  // nothing.
  it("marks a generated day as an AI starter, and says nothing about a human one", async () => {
    searchPlaybooksMock.mockResolvedValue(
      ok(
        response({
          days: [
            day({ savedDayId: "aa000000-0000-4000-8000-000000000009", name: "Railay at first light", authorKind: "ai" }),
            day({ name: "Kyoto temples on foot", authorKind: "human" }),
          ],
        }),
      ),
    );
    render(<DiscoverScreen />);
    expect(await screen.findByText("Railay at first light")).toBeTruthy();
    // One badge for two cards: the human day carries none.
    expect(screen.getAllByText("AI starter")).toHaveLength(1);
  });

  it("shows a skeleton grid before the first answer arrives, and never after", async () => {
    let release: (value: unknown) => void = () => {};
    searchPlaybooksMock.mockReturnValueOnce(new Promise((r) => (release = r)));
    render(<DiscoverScreen />);
    expect(screen.getByTestId("discover-skeleton")).toBeTruthy();
    release(ok(response()));
    await waitFor(() => expect(screen.queryByTestId("discover-skeleton")).toBeNull());
  });

  // The exit-gate line: matched filled, the rest outlined, and the per-card
  // line present.
  it("fills the matched city, outlines the rest, and prints the per-card line", async () => {
    searchPlaybooksMock.mockResolvedValue(
      ok(response({ days: [day({ cities: ["Kyoto", "Uji"], matchedCities: ["Kyoto"] })] })),
    );
    render(<DiscoverScreen />);
    // eslint-disable-next-line testing-library/prefer-find-by -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    await waitFor(() => expect(screen.getByTestId("match-line")).toBeTruthy());

    expect(screen.getByTestId("match-line").textContent).toBe("Kyoto matched · also Uji");
    const chips = screen.getByTestId("city-chips");
    expect(within(chips).getByText("Kyoto").getAttribute("data-matched")).toBe("true");
    expect(within(chips).getByText("Uji").getAttribute("data-matched")).toBe("false");
  });

  // The card's money line is the day's TOTAL, and must not qualify it "each".
  // It read "$27.00 each" for a number `savedDayFacts` builds by adding up
  // `stop.cost` and dividing by nothing — Mitchell, 2026-09-01: *"why are we
  // calculating per person in a notebook? just show total cost there."*
  // Pinned by a test because the old string had none: a per-person claim that
  // lives only in a template literal is exactly the "invariant asserted by a
  // name with nothing behind it" this repo keeps rediscovering (KI-1, KI-14),
  // and the rename alone would not stop somebody re-adding the word.
  it("prints the day's total with no per-person qualifier on it", async () => {
    render(<DiscoverScreen />);
    // eslint-disable-next-line testing-library/prefer-find-by -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    await waitFor(() => expect(screen.getByTestId("discover-results")).toBeTruthy());
    const line = screen.getByText(/\$27\.00/);
    expect(line.textContent).toContain("$27.00");
    expect(line.textContent).not.toMatch(/each/i);
  });

  it("says nothing about matching on an unfiltered browse", () => {
    expect(matchLine({ cities: ["Kyoto"], matchedCities: [] })).toBeNull();
    expect(matchLine({ cities: ["Kyoto"], matchedCities: ["Kyoto"] })).toBe("Kyoto matched");
  });

  // **A TAB since M26 link 2** (SPEC §33.2), not a `SegmentedControl` pill —
  // scope is a PLACE, and a pill is what a filter looks like on this page. It
  // is still not a second route, which is the half of this claim that survives
  // the change of control.
  it("sends the scope as a tab, and it is still a place on this page rather than a link", async () => {
    render(<DiscoverScreen />);
    await waitFor(() => expect(searchPlaybooksMock).toHaveBeenCalled());
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(
      screen.getByRole("tab", { name: "Yours" }),
    );
    await waitFor(() =>
      expect(searchPlaybooksMock).toHaveBeenLastCalledWith(expect.objectContaining({ scope: "yours" })),
    );
    // Not a second page: no navigation, and the results list is still the one
    // this component owns.
    expect(screen.queryByRole("link", { name: /yours/i })).toBeNull();
  });

  // Two sorts — §15 asks for four, and the two missing ones need review data
  // M12 owns. **And no rating filter**, for the same reason: §35.5 puts Rating
  // in the Filters menu, and building it over a reviews table that does not
  // exist would be a control that does nothing (project rule 2, M27 D8). This
  // is the assertion that stops somebody helpfully "fixing" either back.
  it("offers exactly two sorts and no rating filter", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<DiscoverScreen />);
    // eslint-disable-next-line testing-library/prefer-find-by -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    await waitFor(() => expect(screen.getByTestId("discover-results")).toBeTruthy());

    // Sort rides the results sentence now, not the filter row.
    await user.click(screen.getByTestId("discover-sort"));
    expect(screen.getByTestId("discover-sort-most-added").textContent).toBe("Most added");
    expect(screen.getByTestId("discover-sort-newest").textContent).toBe("Newest");
    expect(screen.queryByTestId("discover-sort-highest-rated")).toBeNull();

    expect(screen.queryByTestId("filter-chip-rating")).toBeNull();
    await user.click(screen.getByTestId("filter-more"));
    expect(screen.queryByText("Rating")).toBeNull();
    expect(screen.queryByTestId("filter-more-rating-any")).toBeNull();
    // Season is cut entirely (§33.2) — header, query and rail.
    expect(screen.queryByTestId("filter-chip-season")).toBeNull();
    expect(screen.queryByLabelText(/season/i)).toBeNull();
  });

  // Four bands over three edges (Mitchell, Vercel toolbar comment on
  // `/playbooks` at 411px, 2026-09-01: "the default budget options are pretty
  // unrealistic, let's make them sub 200, sub 500, sub 1000 and above 1000"),
  // read as mutually exclusive ranges rather than four overlapping "sub N"s —
  // see `BudgetBand` in lib/playbooks.ts. This is the assertion that pins the
  // labels (and therefore the edges: $200 / $500 / $1,000) so a future change
  // to `BUDGET_BAND_EDGES` cannot drift from what the control actually shows.
  it("offers four budget bands over $200/$500/$1,000, not the old three", async () => {
    render(<DiscoverScreen />);
    // eslint-disable-next-line testing-library/prefer-find-by -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    await waitFor(() => expect(screen.getByTestId("discover-results")).toBeTruthy());
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(
      screen.getByTestId("filter-more"),
    );
    for (const label of [
      "Any budget",
      "Under $200.00",
      "$200.00 – $500.00",
      "$500.00 – $1,000.00",
      "Over $1,000.00",
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  // §35.5: one *Filters* menu holds every filter, and there are no face chips.
  // A set filter surfaces as its own chip reading **its value** — one still
  // reading "Budget" once a budget is chosen makes the reader open it to find
  // out what they asked for — and that chip clears it in place.
  it("reaches Budget through the Filters menu, then shows it as a chip that clears in place", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<DiscoverScreen />);
    // eslint-disable-next-line testing-library/prefer-find-by -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    await waitFor(() => expect(screen.getByTestId("discover-results")).toBeTruthy());
    expect(screen.queryByTestId("filter-chip-budget")).toBeNull();

    await user.click(screen.getByTestId("filter-more"));
    await user.click(screen.getByTestId("filter-more-budget-under200"));
    await waitFor(() =>
      expect(searchPlaybooksMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ budget: "under200" }),
      ),
    );
    expect(chipText(screen.getByTestId("filter-chip-budget"))).toBe("Under $200.00");

    await user.keyboard("{Escape}");
    await user.click(screen.getByTestId("filter-chip-budget"));
    await user.click(screen.getByTestId("filter-budget-any"));
    await waitFor(() =>
      expect(searchPlaybooksMock).toHaveBeenLastCalledWith(expect.objectContaining({ budget: "any" })),
    );
    expect(screen.queryByTestId("filter-chip-budget")).toBeNull();
  });

  // §35.5: the trigger says how many questions are being asked — never the
  // scope or the sort — and wears the brand tint once it is more than none.
  it("labels the trigger Filters, then Filters · N as questions are asked", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<DiscoverScreen />);
    // eslint-disable-next-line testing-library/prefer-find-by -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    await waitFor(() => expect(screen.getByTestId("discover-results")).toBeTruthy());
    expect(chipText(screen.getByTestId("filter-more"))).toBe("Filters");

    await user.click(screen.getByTestId("discover-sort"));
    await user.click(screen.getByTestId("discover-sort-newest"));
    expect(chipText(screen.getByTestId("filter-more"))).toBe("Filters");

    await user.click(screen.getByTestId("filter-more"));
    await user.click(screen.getByTestId("filter-more-budget-under200"));
    await user.click(screen.getByTestId("filter-more-length-one"));
    expect(chipText(screen.getByTestId("filter-more"))).toBe("Filters · 2");
  });

  // Length appears in the row only once it carries a value, and lives in the
  // *Filters* menu until then.
  it("keeps Length out of the row until it is asked, then shows it as a chip", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<DiscoverScreen />);
    // eslint-disable-next-line testing-library/prefer-find-by -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    await waitFor(() => expect(screen.getByTestId("discover-results")).toBeTruthy());
    expect(screen.queryByTestId("filter-chip-length")).toBeNull();

    await user.click(screen.getByTestId("filter-more"));
    await user.click(screen.getByTestId("filter-more-length-two-three"));
    await waitFor(() =>
      expect(searchPlaybooksMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ length: "two-three" }),
      ),
    );
    expect(chipText(screen.getByTestId("filter-chip-length"))).toBe("2-3 days");
  });

  // **The season filter is cut** (§33.2 — it filtered on the month a day was
  // run and nobody used it). This test used to drive it; it now holds the cut,
  // because a filter removed with nothing asserting its absence is one that
  // quietly comes back.
  //
  // **The concept is not cut.** `seasonOfMonth` and `SEASON_MONTHS` stay —
  // `pnpm content:verify` prints season occupancy and is a separate consumer.
  it("no longer filters by season, and never sends one", async () => {
    render(<DiscoverScreen />);
    // eslint-disable-next-line testing-library/prefer-find-by -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    await waitFor(() => expect(screen.getByTestId("discover-results")).toBeTruthy());

    expect(screen.queryByLabelText(/season/i)).toBeNull();
    expect(screen.queryByText(/any season/i)).toBeNull();
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(
      screen.getByTestId("filter-more"),
    );
    expect(screen.queryByText(/season/i)).toBeNull();

    for (const call of searchPlaybooksMock.mock.calls) {
      expect(call[0]).not.toHaveProperty("season");
    }
  });

  // The budget bands compare minor units, so they only mean something inside
  // one currency. A mixed result set hides the control rather than comparing
  // numbers that are not comparable.
  it("hides the budget filter when the results do not share a currency", async () => {
    searchPlaybooksMock.mockResolvedValue(ok(response({ budgetCurrency: null })));
    render(<DiscoverScreen />);
    // eslint-disable-next-line testing-library/prefer-find-by -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    await waitFor(() => expect(screen.getByTestId("discover-results")).toBeTruthy());
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(screen.getByTestId("filter-more"));
    expect(screen.queryByText("Budget")).toBeNull();
    expect(screen.queryByTestId("filter-more-budget-any")).toBeNull();
    expect(screen.getByTestId("filter-more-length-any")).toBeTruthy();
  });

  // ONE way out of the empty state, not two. "Drop the filters" and "Search
  // everywhere" both reset to the same no-filters state, and the first was
  // disabled in exactly the case the empty state was unreachable — a dead
  // control beside a live one (Mitchell, 2026-09-01).
  it("offers only Search everywhere when nothing matches, and it really clears the filters", async () => {
    searchPlaybooksMock.mockResolvedValue(ok(response({ days: [] })));
    render(<DiscoverScreen />);
    // eslint-disable-next-line testing-library/prefer-find-by -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    await waitFor(() => expect(screen.getByText("No days match")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Drop the filters" })).toBeNull();

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByTestId("filter-more"));
    await user.click(screen.getByTestId("filter-more-length-four-six"));
    await waitFor(() =>
      expect(searchPlaybooksMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ length: "four-six" }),
      ),
    );
    await user.click(screen.getByTestId("discover-search-everywhere"));
    await waitFor(() =>
      expect(searchPlaybooksMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ cities: [], budget: "any", length: "any" }),
      ),
    );
  });

  // **A place is never reset by a control about questions** (§33.2). *Search
  // everywhere* used to spread `NO_FILTERS`, which put `scope` back to
  // `everyone` — so somebody looking at *Saved*, finding nothing and asking to
  // widen the search was moved to a different place without asking.
  it("keeps the scope when Search everywhere drops the questions", async () => {
    searchPlaybooksMock.mockResolvedValue(ok(response({ days: [] })));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<DiscoverScreen />);
    // eslint-disable-next-line testing-library/prefer-find-by -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    await waitFor(() => expect(screen.getByRole("tab", { name: "Saved" })).toBeTruthy());

    await user.click(screen.getByRole("tab", { name: "Saved" }));
    await waitFor(() =>
      expect(searchPlaybooksMock).toHaveBeenLastCalledWith(expect.objectContaining({ scope: "saved" })),
    );

    await user.click(screen.getByTestId("discover-search-everywhere"));
    await waitFor(() =>
      expect(searchPlaybooksMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ scope: "saved", cities: [] }),
      ),
    );
  });

  // §33.2: the count excludes scope and sort. The phone badge used to count
  // "sorted by newest" as a filter, which it is not.
  it("counts only the questions, never the place or the ordering", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<DiscoverScreen />);
    // eslint-disable-next-line testing-library/prefer-find-by -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    await waitFor(() => expect(screen.getByTestId("discover-results")).toBeTruthy());
    // Nothing asked yet: no Clear filters at all.
    expect(screen.queryByTestId("discover-clear-filters")).toBeNull();

    // A place and an ordering are not questions.
    await user.click(screen.getByRole("tab", { name: "Yours" }));
    await user.click(screen.getByTestId("discover-sort"));
    await user.click(screen.getByTestId("discover-sort-newest"));
    expect(screen.queryByTestId("discover-clear-filters")).toBeNull();

    // A question is.
    await user.click(screen.getByTestId("filter-more"));
    await user.click(screen.getByTestId("filter-more-budget-over1000"));
    await user.keyboard("{Escape}");
    expect(screen.getByTestId("discover-clear-filters").textContent).toContain("(1)");

    // And clearing them leaves the place and the ordering where they were.
    await user.click(screen.getByTestId("discover-clear-filters"));
    await waitFor(() =>
      expect(searchPlaybooksMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ scope: "yours", sort: "newest", budget: "any" }),
      ),
    );
  });

  // §33.2: the sentence states the COUNT only. It used to end ", most added
  // first" — beside a live Sort control that both duplicated it and could
  // contradict it.
  it("states the count and nothing about the ordering", async () => {
    searchPlaybooksMock.mockResolvedValue(
      ok(response({ days: [day(), day({ savedDayId: "aa000000-0000-4000-8000-000000000002" })] })),
    );
    render(<DiscoverScreen />);
    const line = await screen.findByTestId("discover-results-line");
    expect(line.textContent).toBe("2 shared days");
    expect(line.textContent).not.toMatch(/most added|newest|first/i);
  });

  // §33.2 spells the sentence `N shared days · <sort> ▾`, and the `·` was
  // missing: the count and the sort sat side by side with only a `gap-x-3.5`
  // between them, which reads as two controls rather than one sentence. Found
  // by looking at the preview, 2026-09-20 — no assertion in this file was
  // wrong, because none of them named the separator.
  //
  // It is asserted as a SIBLING of the count rather than inside it: the sort
  // control is hidden on a phone (it lives in the filter sheet there) and the
  // separator is hidden with it, so folding the `·` into
  // `discover-results-line` would leave a middot trailing the count alone.
  it("separates the count from the sort with a middot", async () => {
    render(<DiscoverScreen />);
    const sep = await screen.findByTestId("discover-results-sep");
    expect(sep.textContent).toBe("·");
    // Decorative punctuation between two elements — a screen reader that read
    // "middot" here would be reading the layout out loud.
    expect(sep.getAttribute("aria-hidden")).toBe("true");
    expect((await screen.findByTestId("discover-results-line")).textContent).not.toContain("·");
  });

  it("says one shared day rather than 1 shared days", async () => {
    render(<DiscoverScreen />);
    expect((await screen.findByTestId("discover-results-line")).textContent).toBe("1 shared day");
  });

  // "Who shares the most" over a library nobody has shared into ranks an empty
  // column. `sharedDayCount` ignores every filter on the query, so a search
  // that matches nothing does not take the link away — only an empty library
  // does.
  it("shows the leaderboard link only when something is published", async () => {
    render(<DiscoverScreen />);
    // eslint-disable-next-line testing-library/prefer-find-by -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    await waitFor(() => expect(screen.getByTestId("discover-results")).toBeTruthy());
    // Discover is the board's only entrance (project rule 1: not in the top
    // bar), so where the link goes is part of the same claim as whether it is
    // here at all.
    expect(screen.getByRole("link", { name: /Who shares the most/ }).getAttribute("href")).toBe(
      "/playbooks/board",
    );

    cleanup();
    searchPlaybooksMock.mockResolvedValue(ok(response({ days: [], sharedDayCount: 0 })));
    render(<DiscoverScreen />);
    // eslint-disable-next-line testing-library/prefer-find-by -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    await waitFor(() => expect(screen.getByText("No days match")).toBeTruthy());
    expect(screen.queryByRole("link", { name: /Who shares the most/ })).toBeNull();
  });

  // A filtered-to-nothing search is not an empty library: the link stays.
  it("keeps the leaderboard link when the query matches nothing but the library is not empty", async () => {
    searchPlaybooksMock.mockResolvedValue(ok(response({ days: [], sharedDayCount: 7 })));
    render(<DiscoverScreen />);
    // eslint-disable-next-line testing-library/prefer-find-by -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    await waitFor(() => expect(screen.getByText("No days match")).toBeTruthy());
    expect(screen.getByRole("link", { name: /Who shares the most/ })).toBeTruthy();
  });

  it("labels the chip row Busy right now with no query, and Also in these results with one", async () => {
    searchPlaybooksMock.mockResolvedValue(ok(response({ siblings: [{ city: "Osaka", days: 4 }] })));
    render(<DiscoverScreen />);
    // eslint-disable-next-line testing-library/prefer-find-by -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    await waitFor(() => expect(screen.getByTestId("sibling-cities")).toBeTruthy());
    expect(screen.getByText("Busy right now")).toBeTruthy();

    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(
      screen.getByRole("button", { name: "Add Osaka" }),
    );
    // eslint-disable-next-line testing-library/prefer-find-by -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    await waitFor(() => expect(screen.getByText("Also in these results")).toBeTruthy());
    expect(searchPlaybooksMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ cities: ["Osaka"] }),
    );
  });

  it("seeds its cities from the URL, so a profile chip lands on a scoped search", async () => {
    render(<DiscoverScreen initialCities={["Hakone"]} />);
    await waitFor(() =>
      expect(searchPlaybooksMock).toHaveBeenCalledWith(expect.objectContaining({ cities: ["Hakone"] })),
    );
  });

  // Project rule 6, the sync-fail half. The previous results stay on screen —
  // a dropped connection is not a reason to blank a page that was true a second
  // ago — and Retry is a real control.
  it("keeps the results under a failure banner, and retries for real", async () => {
    render(<DiscoverScreen />);
    // eslint-disable-next-line testing-library/prefer-find-by -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    await waitFor(() => expect(screen.getByTestId("discover-results")).toBeTruthy());

    searchPlaybooksMock.mockResolvedValueOnce({
      ok: false,
      error: { status: 0, message: "Network error" },
    });
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(
      screen.getByRole("tab", { name: "Yours" }),
    );
    // eslint-disable-next-line testing-library/prefer-find-by -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    await waitFor(() => expect(screen.getByTestId("library-sync-failure")).toBeTruthy());
    expect(screen.getByText("Kyoto temples on foot")).toBeTruthy();

    const callsBeforeRetry = searchPlaybooksMock.mock.calls.length;
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(
      within(screen.getByTestId("library-sync-failure")).getByRole("button", { name: "Retry" }),
    );
    await waitFor(() => expect(screen.queryByTestId("library-sync-failure")).toBeNull());
    // "retries for real" means a SECOND read happened. The banner clearing on
    // the click alone would satisfy the assertion above, because the base mock
    // already resolves and only the first call was made to fail.
    expect(searchPlaybooksMock.mock.calls.length).toBeGreaterThan(callsBeforeRetry);
  });

  // Project rule 6, the conflict half — and the half of it Discover gets WRONG
  // if the banner is not scoped to one query. Changing a filter re-asks a
  // different question, and a different answer to a different question is not
  // the library moving; this used to raise the banner on every filter change,
  // which is the "retrain everyone to ignore the line" failure the hook's own
  // doc comment warns about (CodeRabbit, PR 102).
  //
  // The banner's real behaviour — a reload of the SAME query answering
  // differently — is `useLibraryRead.test.tsx`'s, because on this screen every
  // re-read is a new query and there is nothing here that can produce the
  // genuine case.
  it("does not call a filter change the library moving", async () => {
    render(<DiscoverScreen />);
    // eslint-disable-next-line testing-library/prefer-find-by -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    await waitFor(() => expect(screen.getByTestId("discover-results")).toBeTruthy());
    expect(screen.queryByTestId("library-moved")).toBeNull();

    // A wholly different result set, which is the ordinary outcome of narrowing
    // a filter rather than evidence that anything moved.
    searchPlaybooksMock.mockResolvedValue(
      ok(response({ days: [day({ savedDayId: "aa000000-0000-4000-8000-000000000009", adds: 9 })] })),
    );
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(
      screen.getByRole("tab", { name: "Yours" }),
    );
    await waitFor(() =>
      expect(searchPlaybooksMock).toHaveBeenLastCalledWith(expect.objectContaining({ scope: "yours" })),
    );
    expect(screen.getByTestId("discover-results")).toBeTruthy();
    expect(screen.queryByTestId("library-moved")).toBeNull();
  });

});

// The exit gate names four states for city search and asks that all four be
// reachable against the real endpoint. These prove the component renders each
// one distinctly; `api/cities/route.int.test.ts` proves the endpoint produces
// them, and the e2e spec walks the pair.
// M23. The card's multi-day branch and the length filter's wiring both shipped
// with the fixture pinned at `dayCount: 1`, so neither was ever exercised here
// — the single-day path asserts nothing about them. Raised by CodeRabbit on
// PR #192, and correctly: a default that never varies is not coverage.
describe("Discover, for a Playbook that is more than one day", () => {
  it("leads the card with the day count", async () => {
    searchPlaybooksMock.mockResolvedValue(ok(response({ days: [day({ dayCount: 3 })] })));
    render(<DiscoverScreen />);
    expect(await screen.findByText(/3 days · 4 stops/)).toBeTruthy();
  });

  // Suppressed at one day on purpose: "1 day ·" on every card is noise that
  // teaches a reader to stop reading the line.
  it("says nothing about days when there is only one", async () => {
    render(<DiscoverScreen />);
    expect(await screen.findByText(/4 stops/)).toBeTruthy();
    expect(screen.queryByText(/1 day ·/)).toBeNull();
  });

  it("sends the chosen length band to the endpoint", async () => {
    render(<DiscoverScreen />);
    await screen.findByText(/4 stops/);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    // Length lives in *More filters* now (§33.2) — it is not a face chip.
    await user.click(screen.getByTestId("filter-more"));
    await user.click(screen.getByTestId("filter-more-length-two-three"));
    await waitFor(() =>
      expect(searchPlaybooksMock).toHaveBeenLastCalledWith(expect.objectContaining({ length: "two-three" })),
    );
  });

  it("starts unfiltered by length", async () => {
    render(<DiscoverScreen />);
    await waitFor(() =>
      expect(searchPlaybooksMock).toHaveBeenLastCalledWith(expect.objectContaining({ length: "any" })),
    );
  });
});

describe("Discover city search", () => {
  it("shows loading, then the matches, and adds one as a chip", async () => {
    render(<DiscoverScreen />);
    // eslint-disable-next-line testing-library/prefer-find-by -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    await waitFor(() => expect(screen.getByTestId("discover-results")).toBeTruthy());

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.type(screen.getByLabelText("Search cities"), "Kyo");
    // Nothing has been asked yet — the debounce has not elapsed.
    expect(searchCitiesMock).not.toHaveBeenCalled();

    let release: (value: unknown) => void = () => {};
    searchCitiesMock.mockReturnValueOnce(new Promise((r) => (release = r)));
    await vi.advanceTimersByTimeAsync(300);
    // eslint-disable-next-line testing-library/prefer-find-by -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    await waitFor(() => expect(screen.getByTestId("city-search-loading")).toBeTruthy());

    release(ok([{ city: "Kyoto", days: 3 }]));
    // eslint-disable-next-line testing-library/prefer-find-by -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    await waitFor(() => expect(screen.getByTestId("city-search-results")).toBeTruthy());

    await user.click(screen.getByRole("button", { name: /Kyoto · 3/ }));
    await waitFor(() =>
      expect(searchPlaybooksMock).toHaveBeenLastCalledWith(expect.objectContaining({ cities: ["Kyoto"] })),
    );
    expect(within(screen.getByTestId("selected-cities")).getByRole("button", { name: "Remove Kyoto" })).toBeTruthy();
  });

  it("says no city matches — a real answer, not a failure", async () => {
    render(<DiscoverScreen />);
    searchCitiesMock.mockResolvedValue(ok([]));
    await typeCity("Zzz");
    // eslint-disable-next-line testing-library/prefer-find-by -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    await waitFor(() => expect(screen.getByTestId("city-search-empty")).toBeTruthy());
    expect(screen.queryByTestId("city-search-failed")).toBeNull();
  });

  it("offers a Retry that re-runs the same query, not a cleared box", async () => {
    render(<DiscoverScreen />);
    searchCitiesMock.mockResolvedValue({ ok: false, error: { status: 0, message: "Network error" } });
    await typeCity("Kyo");
    // eslint-disable-next-line testing-library/prefer-find-by -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    await waitFor(() => expect(screen.getByTestId("city-search-failed")).toBeTruthy());

    searchCitiesMock.mockResolvedValue(ok([{ city: "Kyoto", days: 3 }]));
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(
      within(screen.getByTestId("city-search-failed")).getByRole("button", { name: "Retry" }),
    );
    // eslint-disable-next-line testing-library/prefer-find-by -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    await waitFor(() => expect(screen.getByTestId("city-search-results")).toBeTruthy());
    // The same query, not a fresh one — a person who typed "Kyo" and lost their
    // connection wants "Kyo" back.
    expect(searchCitiesMock).toHaveBeenLastCalledWith("Kyo");
  });

  it("has no <option> city list — the dropdown is gone and must not come back", async () => {
    const { container } = render(<DiscoverScreen />);
    // eslint-disable-next-line testing-library/prefer-find-by -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    await waitFor(() => expect(screen.getByTestId("discover-results")).toBeTruthy());
    expect(screen.queryByLabelText("City")).toBeNull();
    // The two selects that DO exist are the sort and the two filters; none of
    // them lists cities.
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    for (const select of container.querySelectorAll("select")) {
      expect([...select.options].map((o) => o.textContent)).not.toContain("Kyoto");
    }
  });
});

// M26 Wave 2, link 12 — §16 asks for full phone parity, and project rule 3
// forbids the desktop's shape outright: a popover opening from a row of
// popovers, on a screen where each one covers the list it is filtering.
describe("the phone's one filter sheet", () => {
  const openSheet = async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<DiscoverScreen />);
    // eslint-disable-next-line testing-library/prefer-find-by -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    await waitFor(() => expect(screen.getByTestId("discover-results")).toBeTruthy());
    await user.click(screen.getByTestId("discover-phone-filters"));
    await screen.findByTestId("discover-filter-sheet");
    return user;
  };

  it("holds every filter in one place", async () => {
    await openSheet();
    const sheet = screen.getByTestId("discover-filter-sheet");
    expect(within(sheet).getByTestId("sheet-budget-under200")).toBeTruthy();
    expect(within(sheet).getByTestId("sheet-length-two-three")).toBeTruthy();
  });

  // Sort is a property of the list, and with only one place to put the
  // questions it belongs with them — but it is still not one of them.
  it("holds sort as well, and still does not count it as a filter", async () => {
    const user = await openSheet();
    await user.click(screen.getByTestId("sheet-sort-newest"));
    await waitFor(() =>
      expect(searchPlaybooksMock).toHaveBeenLastCalledWith(expect.objectContaining({ sort: "newest" })),
    );
    // The badge on the button counts questions only. The phone badge used to
    // count "sorted by newest" as a filter, which is the defect §33.2 names.
    expect(screen.getByTestId("discover-phone-filters").textContent).toBe("Filters");
  });

  it("counts the questions on the button once they are asked", async () => {
    const user = await openSheet();
    await user.click(screen.getByTestId("sheet-budget-under200"));
    // The desktop trigger's words (§35.5), so one state is not spelt two ways.
    expect(screen.getByTestId("discover-phone-filters").textContent).toBe("Filters · 1");
    await user.click(screen.getByTestId("sheet-length-one"));
    expect(screen.getByTestId("discover-phone-filters").textContent).toBe("Filters · 2");
  });

  // **Scope is deliberately outside the sheet.** A place is not a sheet
  // setting: it stays as the tabs above the search, where it is visible without
  // opening anything.
  it("keeps scope out of the sheet entirely", async () => {
    const user = await openSheet();
    const sheet = screen.getByTestId("discover-filter-sheet");
    for (const label of ["Everyone", "Yours", "Saved"]) {
      expect(within(sheet).queryByText(label)).toBeNull();
    }

    // And scope is still a tab once the sheet is out of the way. It has to be
    // checked AFTER closing: the sheet is a real modal, so Radix `aria-hidden`s
    // the page behind it and nothing back there is reachable by role while it
    // is open — which is itself the right behaviour for a bottom sheet.
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("discover-filter-sheet")).toBeNull());
    expect(screen.getByRole("tab", { name: "Saved" })).toBeTruthy();
  });

  it("clears the questions from inside the sheet, leaving the ordering alone", async () => {
    const user = await openSheet();
    await user.click(screen.getByTestId("sheet-sort-newest"));
    await user.click(screen.getByTestId("sheet-budget-over1000"));
    await user.click(screen.getByTestId("sheet-clear-filters"));
    await waitFor(() =>
      expect(searchPlaybooksMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ budget: "any", sort: "newest" }),
      ),
    );
  });

  // Both shapes render and CSS hides one, so they must not disagree: the sheet
  // and the desktop chips are two sets of controls over ONE state.
  it("shares its state with the desktop chips rather than keeping a second copy", async () => {
    const user = await openSheet();
    await user.click(screen.getByTestId("sheet-budget-under200"));
    expect(chipText(screen.getByTestId("filter-chip-budget"))).toBe("Under $200.00");
  });
});
