import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

// **No `@testing-library/jest-dom` in this repo**, deliberately — assertions
// read the DOM property rather than a matcher that wraps it.
import type { AdminAccountFilter, AdminAccountRow, AdminAccountsPage } from "@/lib/adminOverview";

const push = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace }) }));

import { AccountsPanel, SEARCH_PAUSE_MS } from "./AccountsPanel";
import type { AccountsView } from "./accountsView";

// **What a filter means is the server's now** (M36 perf pass): the six
// counts, the search and the page are read in SQL and held by
// `admin.int.test.ts`. What this file holds is the half that stayed here — the
// page it is handed is drawn as it is, and every change of view is a
// navigation to the right URL.

function account(over: Partial<AdminAccountRow> & { userId: string }): AdminAccountRow {
  return {
    email: `${over.userId}@example.test`,
    planVersionRef: "free@v1",
    isAdmin: false,
    grantSources: [],
    grants: [],
    entitlements: [],
    requests: 0,
    microUsd: 0,
    unpriced: 0,
    paysMicroUsd: 0 as number | null,
    subscriptionState: null,
    lastActiveAt: null,
    ...over,
  };
}

const NO_COUNTS: Record<AdminAccountFilter, number> = {
  all: 0,
  paying: 0,
  granted: 0,
  unentitled: 0,
  pastDue: 0,
  underwater: 0,
};

/** A served page: `rows` are what is drawn, `counts` default to the rows'. */
function page(
  rows: AdminAccountRow[],
  over: Partial<Omit<AdminAccountsPage, "rows">> = {},
): AdminAccountsPage {
  return {
    rows,
    counts: { ...NO_COUNTS, all: rows.length },
    page: 0,
    pageSize: 8,
    underwater: [],
    ...over,
  };
}

function disabled(name: string): boolean {
  return (screen.getByRole("button", { name }) as HTMLButtonElement).disabled;
}

function rowIds(): string[] {
  return screen
    .getAllByTestId(/^account-/)
    .map((row) => row.getAttribute("data-testid")!.replace("account-", ""));
}

const NOW = "2026-10-06T12:00:00.000Z";
const FRESH: AccountsView = { query: "", filter: "all", page: 0 };

function panel(table: AdminAccountsPage, view: AccountsView = FRESH) {
  return <AccountsPanel table={table} view={view} now={NOW} windowDays={30} />;
}

const counts = (name: string) =>
  within(screen.getByRole("button", { name: new RegExp(`^${name}`) })).getByText(/^\d+$/).textContent;

const box = () => screen.getByRole("textbox", { name: "Find an account" }) as HTMLInputElement;

afterEach(() => {
  cleanup();
  push.mockReset();
  replace.mockReset();
  vi.useRealTimers();
});

describe("AccountsPanel", () => {
  it("draws the page it was served, and says where it is in the whole", () => {
    const rows = [account({ userId: "a9" }), account({ userId: "a10" })];
    render(panel(page(rows, { page: 1, counts: { ...NO_COUNTS, all: 10 } }), { ...FRESH, page: 1 }));

    expect(rowIds()).toEqual(["a9", "a10"]);
    expect(screen.getByTestId("accounts-range").textContent).toContain("9–10 of 10");
    expect(disabled("Next")).toBe(true);
    expect(disabled("Previous")).toBe(false);
  });

  // The server clamps a page past the end to the last with rows; the range
  // line and the row links follow the page SERVED, not the one asked for.
  it("follows the page the server served when it is not the one asked for", () => {
    render(
      panel(page([account({ userId: "last" })], { page: 1, counts: { ...NO_COUNTS, all: 9 } }), {
        ...FRESH,
        page: 6,
      }),
    );
    expect(screen.getByTestId("accounts-range").textContent).toContain("9–9 of 9");
    expect(within(screen.getByTestId("account-last")).getByRole("link").getAttribute("href")).toBe(
      "/admin?tab=users&account=last&page=2",
    );
  });

  it("corrects the address bar to the view it drew, and leaves a matching one alone", () => {
    window.history.replaceState(null, "", "/admin?tab=users&page=7&filter=nonsense");
    const spy = vi.spyOn(window.history, "replaceState");
    const { unmount } = render(
      panel(page([account({ userId: "last" })], { page: 1, counts: { ...NO_COUNTS, all: 9 } }), {
        ...FRESH,
        page: 6,
      }),
    );
    expect(spy.mock.calls.map((call: unknown[]) => call[2])).toEqual(["/admin?tab=users&page=2"]);
    expect(window.location.search).toBe("?tab=users&page=2");

    unmount();
    spy.mockClear();
    render(panel(page([account({ userId: "last" })], { page: 1, counts: { ...NO_COUNTS, all: 9 } }), { ...FRESH, page: 1 }));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("pages by navigating, keeping the search and the filter", async () => {
    const user = userEvent.setup();
    const view: AccountsView = { query: "wren", filter: "granted", page: 1 };
    const rows = Array.from({ length: 8 }, (_, i) => account({ userId: `g${i}` }));
    render(panel(page(rows, { page: 1, counts: { ...NO_COUNTS, all: 30, granted: 30 } }), view));

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(replace).toHaveBeenLastCalledWith("/admin?tab=users&q=wren&filter=granted&page=3", { scroll: false });
    await user.click(screen.getByRole("button", { name: "Previous" }));
    expect(replace).toHaveBeenLastCalledWith("/admin?tab=users&q=wren&filter=granted", { scroll: false });
    expect(push).not.toHaveBeenCalled();
  });

  it("shows the six counts the server took over the whole search", () => {
    const served = page([account({ userId: "x" })], {
      counts: { all: 14, paying: 4, granted: 3, unentitled: 7, pastDue: 1, underwater: 2 },
    });
    render(panel(served));
    expect(counts("All")).toBe("14");
    expect(counts("Paying")).toBe("4");
    expect(counts("Granted")).toBe("3");
    expect(counts("Free")).toBe("7");
    expect(counts("Past due")).toBe("1");
    expect(counts("Costs more than it pays")).toBe("2");
  });

  it("presses the URL's filter, and picking another navigates to its first page", async () => {
    const user = userEvent.setup();
    render(panel(page([account({ userId: "x" })], { page: 2 }), { query: "", filter: "granted", page: 2 }));
    expect(screen.getByRole("button", { name: /^Granted/ }).getAttribute("aria-pressed")).toBe("true");

    await user.click(screen.getByRole("button", { name: /^Past due/ }));
    expect(replace).toHaveBeenLastCalledWith("/admin?tab=users&filter=pastDue", { scroll: false });
  });

  // **A keystroke is not a round trip.** The search is sent once typing pauses,
  // and the box keeps every letter meanwhile.
  it("sends the search once typing pauses, not per keystroke", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(panel(page([account({ userId: "x" })]), { query: "", filter: "unentitled", page: 0 }));

    await user.type(box(), "wren");
    expect(box().value).toBe("wren");
    expect(replace).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(SEARCH_PAUSE_MS);
    });
    expect(replace.mock.calls).toEqual([["/admin?tab=users&q=wren&filter=unentitled", { scroll: false }]]);
  });

  // The race the box has to win: a page for an older search lands while the
  // operator is still typing. Their newer text stays, and is sent in turn.
  it("keeps what was typed after the search the server is answering", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { rerender } = render(panel(page([account({ userId: "x" })])));

    await user.type(box(), "wr");
    act(() => {
      vi.advanceTimersByTime(SEARCH_PAUSE_MS);
    });
    expect(replace).toHaveBeenLastCalledWith("/admin?tab=users&q=wr", { scroll: false });

    await user.type(box(), "en");
    rerender(panel(page([account({ userId: "x" })]), { ...FRESH, query: "wr" }));
    expect(box().value).toBe("wren");

    act(() => {
      vi.advanceTimersByTime(SEARCH_PAUSE_MS);
    });
    expect(replace).toHaveBeenLastCalledWith("/admin?tab=users&q=wren", { scroll: false });
  });

  // Back in the middle of typing is the operator leaving what they typed: the
  // box takes the search Back landed on, and the pending send is dropped
  // rather than written over that history entry 300 ms later.
  it("drops what was being typed when Back lands on another search", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { rerender } = render(panel(page([account({ userId: "x" })])));

    await user.type(box(), "zz");
    rerender(panel(page([account({ userId: "x" })]), { ...FRESH, query: "foo" }));
    expect(box().value).toBe("foo");

    act(() => {
      vi.advanceTimersByTime(SEARCH_PAUSE_MS);
    });
    expect(replace).not.toHaveBeenCalled();
  });

  // Back and Forward re-render the page with another view and nothing else;
  // the box and the pills have to follow it.
  it("follows a navigation to a different view", () => {
    const { rerender } = render(panel(page([account({ userId: "x" })])));
    rerender(panel(page([account({ userId: "x" })]), { query: "granted", filter: "granted", page: 0 }));
    expect(box().value).toBe("granted");
    expect(screen.getByRole("button", { name: /^Granted/ }).getAttribute("aria-pressed")).toBe("true");
    expect(replace).not.toHaveBeenCalled();
  });

  it("offers a way out when nothing matches", async () => {
    const user = userEvent.setup();
    render(panel(page([]), { query: "nobody", filter: "granted", page: 0 }));

    expect(screen.queryAllByTestId(/^account-/)).toHaveLength(0);
    expect(screen.getByText("No account matches")).toBeTruthy();
    expect(screen.getByText("No address matches “nobody” in this group.")).toBeTruthy();
    expect(screen.getByTestId("accounts-range").textContent).toContain("No accounts");

    await user.click(screen.getByRole("button", { name: "Clear the filter" }));
    expect(replace).toHaveBeenLastCalledWith("/admin?tab=users", { scroll: false });
    expect(box().value).toBe("");
  });

  it("tints and badges the rows the server says cost more than they pay", () => {
    render(panel(page([account({ userId: "sinking" }), account({ userId: "fine" })], { underwater: ["sinking"] })));
    expect(within(screen.getByTestId("account-sinking")).getByText("Costs more than it pays")).toBeTruthy();
    expect(within(screen.getByTestId("account-fine")).queryByText("Costs more than it pays")).toBeNull();
  });

  it("draws Asked and Last active from the row", () => {
    render(
      panel(
        page([
          account({ userId: "busy", requests: 1234, lastActiveAt: "2026-10-03T09:00:00.000Z" }),
          account({ userId: "idle" }),
        ]),
      ),
    );
    const cells = (id: string) =>
      within(screen.getByTestId(`account-${id}`))
        .getAllByRole("cell")
        .map((cell) => cell.textContent);
    expect(cells("busy")).toEqual(expect.arrayContaining(["1,234", "3 days ago"]));
    // Columns 6 and 7 — Asked, Last active — read `—` when there is nothing.
    expect(cells("idle").slice(5, 7)).toEqual(["—", "—"]);
  });

  // **The whole row opens the account page, with the view kept**, so the
  // account page's *← All accounts* comes back to the same page of the same
  // filter. Ten free accounts searched by "free", on page two of the filter.
  it("links each row to its account, keeping q, filter and page", async () => {
    const user = userEvent.setup();
    const accounts = [8, 9].map((i) => account({ userId: `free${i}` }));
    render(panel(page(accounts, { page: 1 }), { query: "free", filter: "unentitled", page: 1 }));
    const expected = "/admin?tab=users&account=free8&q=free&filter=unentitled&page=2";

    const row = screen.getByTestId("account-free8");
    expect(within(row).getByRole("link").getAttribute("href")).toBe(expected);
    await user.click(within(row).getByText("free@v1"));
    expect(push).toHaveBeenCalledWith(expected);
  });

  // **Grant and Revoke left the row for the account page** (M36 link 3). The
  // row says why the account holds what it holds, in words, and the one
  // thing on it that does anything is the way into the account.
  it("offers no grant or revoke, and names the grant sources as text", () => {
    render(
      panel(
        page([
          account({
            userId: "comped",
            grantSources: ["admin", "founder"],
            grants: [
              { id: "g1", source: "admin", planVersionRef: "premium@v1", expiresAt: null },
              { id: "g2", source: "founder", planVersionRef: "plus@v1", expiresAt: null },
            ] as AdminAccountRow["grants"],
          }),
        ]),
      ),
    );
    const row = screen.getByTestId("account-comped");
    expect(within(row).getByText("admin · founder")).toBeTruthy();
    expect(within(row).queryAllByRole("button")).toEqual([]);
    expect(within(row).getAllByRole("link")).toHaveLength(1);
  });

  // A modifier asks for a new tab or window, which `push` cannot give; the
  // address link is there for that. Each modifier on its own, so one dropped
  // from the guard fails here.
  it("does not open the account on a modified click", async () => {
    const user = userEvent.setup();
    render(panel(page([account({ userId: "solo" })])));
    const cell = within(screen.getByTestId("account-solo")).getByText("free@v1");

    for (const key of ["Meta", "Control", "Shift"]) {
      await user.keyboard(`{${key}>}`);
      await user.click(cell);
      await user.keyboard(`{/${key}}`);
    }
    expect(push).not.toHaveBeenCalled();
    // The witness: the same click unmodified does open it.
    await user.click(cell);
    expect(push).toHaveBeenCalledTimes(1);
  });

  // `fireEvent`, not `user.click`: user-event's pointer collapses the selection
  // on the way down, which is what a click does but not what a drag ends with.
  it("does not open the account when the click ends a text selection", () => {
    render(panel(page([account({ userId: "solo" })])));
    const cell = within(screen.getByTestId("account-solo")).getByText("free@v1");

    window.getSelection()!.selectAllChildren(cell);
    fireEvent.click(cell);
    expect(push).not.toHaveBeenCalled();
    // The witness: with the selection gone, the same click opens it.
    window.getSelection()!.removeAllRanges();
    fireEvent.click(cell);
    expect(push).toHaveBeenCalledTimes(1);
  });
});
