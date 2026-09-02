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
    window: { start: "07:30", end: "18:30" },
    totalCost: { amountMinor: 2_700, currency: "USD" },
    adds: 2,
    visibility: "public",
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

  it("sends the scope segment, and it is a filter on this page rather than a link", async () => {
    render(<DiscoverScreen />);
    await waitFor(() => expect(searchPlaybooksMock).toHaveBeenCalled());
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(
      screen.getByRole("radio", { name: "Yours" }),
    );
    await waitFor(() =>
      expect(searchPlaybooksMock).toHaveBeenLastCalledWith(expect.objectContaining({ scope: "yours" })),
    );
    // Not a second page: no navigation, and the results list is still the one
    // this component owns.
    expect(screen.queryByRole("link", { name: /yours/i })).toBeNull();
  });

  // Two sorts, three filters — §15 asks for four of each, and the two missing
  // sorts plus the rating floor need review data M12 owns. This is the
  // assertion that stops somebody helpfully "fixing" them back.
  it("offers exactly two sorts and no rating floor", async () => {
    render(<DiscoverScreen />);
    // eslint-disable-next-line testing-library/prefer-find-by -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    await waitFor(() => expect(screen.getByTestId("discover-results")).toBeTruthy());
    const sort = screen.getByLabelText("Sort");
    expect(within(sort).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Most added",
      "Newest",
    ]);
    expect(screen.queryByLabelText(/rating/i)).toBeNull();
    expect(screen.getByLabelText("Budget")).toBeTruthy();
    expect(screen.getByLabelText("Season")).toBeTruthy();
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
    const budget = screen.getByLabelText("Budget");
    expect(within(budget).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Any budget",
      "Under $200.00",
      "$200.00 – $500.00",
      "$500.00 – $1,000.00",
      "Over $1,000.00",
    ]);
  });

  // The month dropdown this replaced had twelve options over a library of a few
  // dozen days, so most of them returned nothing. Four buckets, and the value
  // that reaches the endpoint is the SEASON — the month-to-season lookup lives
  // on the server side of the query, not in a widened set of month parameters.
  it("filters by season, and sends the season rather than a month", async () => {
    render(<DiscoverScreen />);
    // eslint-disable-next-line testing-library/prefer-find-by -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    await waitFor(() => expect(screen.getByTestId("discover-results")).toBeTruthy());
    const season = screen.getByLabelText("Season");
    expect(within(season).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Any season",
      "Spring",
      "Summer",
      "Fall",
      "Winter",
    ]);

    await userEvent
      .setup({ advanceTimers: vi.advanceTimersByTime })
      .selectOptions(season, "fall");
    await waitFor(() =>
      expect(searchPlaybooksMock).toHaveBeenLastCalledWith(expect.objectContaining({ season: "fall" })),
    );
  });

  // The budget bands compare minor units, so they only mean something inside
  // one currency. A mixed result set hides the control rather than comparing
  // numbers that are not comparable.
  it("hides the budget filter when the results do not share a currency", async () => {
    searchPlaybooksMock.mockResolvedValue(ok(response({ budgetCurrency: null })));
    render(<DiscoverScreen />);
    // eslint-disable-next-line testing-library/prefer-find-by -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    await waitFor(() => expect(screen.getByTestId("discover-results")).toBeTruthy());
    expect(screen.queryByLabelText("Budget")).toBeNull();
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
    await user.selectOptions(screen.getByLabelText("Season"), "winter");
    await waitFor(() =>
      expect(searchPlaybooksMock).toHaveBeenLastCalledWith(expect.objectContaining({ season: "winter" })),
    );
    await user.click(screen.getByRole("button", { name: "Search everywhere" }));
    await waitFor(() =>
      expect(searchPlaybooksMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ season: null, cities: [], budget: "any", scope: "everyone" }),
      ),
    );
  });

  // "Who shares the most" over a library nobody has shared into ranks an empty
  // column. `sharedDayCount` ignores every filter on the query, so a search
  // that matches nothing does not take the link away — only an empty library
  // does.
  it("shows the leaderboard link only when something is published", async () => {
    render(<DiscoverScreen />);
    // eslint-disable-next-line testing-library/prefer-find-by -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    await waitFor(() => expect(screen.getByTestId("discover-results")).toBeTruthy());
    expect(screen.getByRole("link", { name: /Who shares the most/ })).toBeTruthy();

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
      screen.getByRole("radio", { name: "Yours" }),
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
      screen.getByRole("radio", { name: "Yours" }),
    );
    await waitFor(() =>
      expect(searchPlaybooksMock).toHaveBeenLastCalledWith(expect.objectContaining({ scope: "yours" })),
    );
    expect(screen.getByTestId("discover-results")).toBeTruthy();
    expect(screen.queryByTestId("library-moved")).toBeNull();
  });

  // The board's only entrance (project rule 1: not in the top bar).
  it("is where the leaderboard is entered from", async () => {
    render(<DiscoverScreen />);
    // eslint-disable-next-line testing-library/prefer-find-by -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    await waitFor(() => expect(screen.getByTestId("discover-results")).toBeTruthy());
    expect(screen.getByRole("link", { name: /who shares the most/i }).getAttribute("href")).toBe(
      "/playbooks/board",
    );
  });
});

// The exit gate names four states for city search and asks that all four be
// reachable against the real endpoint. These prove the component renders each
// one distinctly; `api/cities/route.int.test.ts` proves the endpoint produces
// them, and the e2e spec walks the pair.
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
