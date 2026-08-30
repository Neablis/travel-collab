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
    budgetPerPerson: { amountMinor: 2_700, currency: "USD" },
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
  return { days: [day()], siblings: [], budgetCurrency: "USD", truncated: false, ...over };
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
    await waitFor(() => expect(screen.getByTestId("match-line")).toBeTruthy());

    expect(screen.getByTestId("match-line").textContent).toBe("Kyoto matched · also Uji");
    const chips = screen.getByTestId("city-chips");
    expect(within(chips).getByText("Kyoto").getAttribute("data-matched")).toBe("true");
    expect(within(chips).getByText("Uji").getAttribute("data-matched")).toBe("false");
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
    await waitFor(() => expect(screen.getByTestId("discover-results")).toBeTruthy());
    const sort = screen.getByLabelText("Sort");
    expect(within(sort).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Most added",
      "Newest",
    ]);
    expect(screen.queryByLabelText(/rating/i)).toBeNull();
    expect(screen.getByLabelText("Budget each")).toBeTruthy();
    expect(screen.getByLabelText("Kept in")).toBeTruthy();
  });

  // The budget bands compare minor units, so they only mean something inside
  // one currency. A mixed result set hides the control rather than comparing
  // numbers that are not comparable.
  it("hides the budget filter when the results do not share a currency", async () => {
    searchPlaybooksMock.mockResolvedValue(ok(response({ budgetCurrency: null })));
    render(<DiscoverScreen />);
    await waitFor(() => expect(screen.getByTestId("discover-results")).toBeTruthy());
    expect(screen.queryByLabelText("Budget each")).toBeNull();
  });

  it("offers Drop the filters and Search everywhere when nothing matches", async () => {
    searchPlaybooksMock.mockResolvedValue(ok(response({ days: [] })));
    render(<DiscoverScreen />);
    await waitFor(() => expect(screen.getByText("No days match")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Drop the filters" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Search everywhere" })).toBeTruthy();
  });

  it("labels the chip row Busy right now with no query, and Also in these results with one", async () => {
    searchPlaybooksMock.mockResolvedValue(ok(response({ siblings: [{ city: "Osaka", days: 4 }] })));
    render(<DiscoverScreen />);
    await waitFor(() => expect(screen.getByTestId("sibling-cities")).toBeTruthy());
    expect(screen.getByText("Busy right now")).toBeTruthy();

    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(
      screen.getByRole("button", { name: "Add Osaka" }),
    );
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
    await waitFor(() => expect(screen.getByTestId("discover-results")).toBeTruthy());

    searchPlaybooksMock.mockResolvedValueOnce({
      ok: false,
      error: { status: 0, message: "Network error" },
    });
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(
      screen.getByRole("radio", { name: "Yours" }),
    );
    await waitFor(() => expect(screen.getByTestId("library-sync-failure")).toBeTruthy());
    expect(screen.getByText("Kyoto temples on foot")).toBeTruthy();

    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(
      within(screen.getByTestId("library-sync-failure")).getByRole("button", { name: "Retry" }),
    );
    await waitFor(() => expect(screen.queryByTestId("library-sync-failure")).toBeNull());
  });

  // Project rule 6, the conflict half. Conflicts are data (invariant 3): the
  // new results are shown, and a line says they are new.
  it("says so when the library moved under it, without blocking anything", async () => {
    render(<DiscoverScreen />);
    await waitFor(() => expect(screen.getByTestId("discover-results")).toBeTruthy());
    expect(screen.queryByTestId("library-moved")).toBeNull();

    searchPlaybooksMock.mockResolvedValue(ok(response({ days: [day({ adds: 9 })] })));
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(
      screen.getByRole("radio", { name: "Yours" }),
    );
    await waitFor(() => expect(screen.getByTestId("library-moved")).toBeTruthy());
    expect(screen.getByTestId("discover-results")).toBeTruthy();

    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(
      within(screen.getByTestId("library-moved")).getByRole("button", { name: "Got it" }),
    );
    expect(screen.queryByTestId("library-moved")).toBeNull();
  });

  // The board's only entrance (project rule 1: not in the top bar).
  it("is where the leaderboard is entered from", async () => {
    render(<DiscoverScreen />);
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
    await waitFor(() => expect(screen.getByTestId("discover-results")).toBeTruthy());

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.type(screen.getByLabelText("Search cities"), "Kyo");
    // Nothing has been asked yet — the debounce has not elapsed.
    expect(searchCitiesMock).not.toHaveBeenCalled();

    let release: (value: unknown) => void = () => {};
    searchCitiesMock.mockReturnValueOnce(new Promise((r) => (release = r)));
    await vi.advanceTimersByTimeAsync(300);
    await waitFor(() => expect(screen.getByTestId("city-search-loading")).toBeTruthy());

    release(ok([{ city: "Kyoto", days: 3 }]));
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
    await waitFor(() => expect(screen.getByTestId("city-search-empty")).toBeTruthy());
    expect(screen.queryByTestId("city-search-failed")).toBeNull();
  });

  it("offers a Retry that re-runs the same query, not a cleared box", async () => {
    render(<DiscoverScreen />);
    searchCitiesMock.mockResolvedValue({ ok: false, error: { status: 0, message: "Network error" } });
    await typeCity("Kyo");
    await waitFor(() => expect(screen.getByTestId("city-search-failed")).toBeTruthy());

    searchCitiesMock.mockResolvedValue(ok([{ city: "Kyoto", days: 3 }]));
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(
      within(screen.getByTestId("city-search-failed")).getByRole("button", { name: "Retry" }),
    );
    await waitFor(() => expect(screen.getByTestId("city-search-results")).toBeTruthy());
    // The same query, not a fresh one — a person who typed "Kyo" and lost their
    // connection wants "Kyo" back.
    expect(searchCitiesMock).toHaveBeenLastCalledWith("Kyo");
  });

  it("has no <option> city list — the dropdown is gone and must not come back", async () => {
    const { container } = render(<DiscoverScreen />);
    await waitFor(() => expect(screen.getByTestId("discover-results")).toBeTruthy());
    expect(screen.queryByLabelText("City")).toBeNull();
    // The two selects that DO exist are the sort and the two filters; none of
    // them lists cities.
    for (const select of container.querySelectorAll("select")) {
      expect([...select.options].map((o) => o.textContent)).not.toContain("Kyoto");
    }
  });
});
