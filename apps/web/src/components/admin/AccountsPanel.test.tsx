import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// **No `@testing-library/jest-dom` in this repo**, deliberately — assertions
// read the DOM property rather than a matcher that wraps it.
import type { AdminAccountRow } from "@/lib/adminOverview";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { AccountsPanel } from "./AccountsPanel";
import type { AccountsView } from "./accountsView";

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

/** Ten accounts: six free, four on a paid plan, three of those granted. */
function tenAccounts(): AdminAccountRow[] {
  return [
    ...Array.from({ length: 6 }, (_, i) => account({ userId: `free${i}` })),
    account({ userId: "paid0", planVersionRef: "plus@v1", paysMicroUsd: 8_000_000, subscriptionState: "active" }),
    ...Array.from({ length: 3 }, (_, i) =>
      account({
        userId: `granted${i}`,
        planVersionRef: "premium@v1",
        grants: [
          { id: `g${i}`, source: "admin", planVersionRef: "premium@v1", expiresAt: null },
        ] as AdminAccountRow["grants"],
      }),
    ),
  ];
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

function panel(
  accounts: AdminAccountRow[],
  options: { initial?: AccountsView; underwater?: string[] } = {},
) {
  return (
    <AccountsPanel
      accounts={accounts}
      plansGrantingNothing={["free"]}
      underwater={options.underwater ?? []}
      initial={options.initial ?? FRESH}
      now={NOW}
      windowDays={30}
    />
  );
}

const counts = (name: string) =>
  within(screen.getByRole("button", { name: new RegExp(`^${name}`) })).getByText(/^\d+$/).textContent;

let replaceState: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  replaceState = vi.spyOn(window.history, "replaceState");
});
afterEach(() => {
  cleanup();
  push.mockReset();
  replaceState.mockRestore();
});

describe("AccountsPanel", () => {
  it("shows one page of eight and pages through the rest", async () => {
    const user = userEvent.setup();
    render(panel(tenAccounts()));

    expect(rowIds()).toHaveLength(8);
    expect(screen.getByTestId("accounts-range").textContent).toContain("1–8 of 10");
    expect(disabled("Previous")).toBe(true);

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(rowIds()).toEqual(["granted1", "granted2"]);
    expect(screen.getByTestId("accounts-range").textContent).toContain("9–10 of 10");
    expect(disabled("Next")).toBe(true);
  });

  it("searches by address", async () => {
    const user = userEvent.setup();
    // **A needle that lives ONLY in the email.** Searching `paid0` matched both
    // the address and the id, so the test passed whether or not `matchesQuery`
    // looked at addresses at all — and "address search" is the feature's name.
    // CodeRabbit, PR #174.
    const accounts = [
      ...tenAccounts(),
      account({ userId: "opaque-id-1", email: "wren@elsewhere.test" }),
    ];
    render(panel(accounts));

    await user.type(screen.getByRole("textbox", { name: "Find an account" }), "wren");
    expect(rowIds()).toEqual(["opaque-id-1"]);
  });

  it("falls back to the account id when a row has no address", async () => {
    const user = userEvent.setup();
    const accounts = [...tenAccounts(), account({ userId: "no-address-1", email: null })];
    render(panel(accounts));

    await user.type(screen.getByRole("textbox", { name: "Find an account" }), "no-address");
    expect(rowIds()).toEqual(["no-address-1"]);
  });

  it("counts each filter over the whole matching set, not the page", async () => {
    render(panel(tenAccounts()));

    // Ten rows, eight of them visible — a count taken from the page would read
    // 8/…/6 here rather than 10/3/6.
    expect(counts("All")).toBe("10");
    expect(counts("Granted")).toBe("3");
    expect(counts("Free")).toBe("6");
  });

  it("narrows the table to the chosen filter", async () => {
    const user = userEvent.setup();
    render(panel(tenAccounts()));

    await user.click(screen.getByRole("button", { name: /^Granted/ }));
    expect(rowIds()).toEqual(["granted0", "granted1", "granted2"]);
    expect(
      screen.getByRole("button", { name: /^Granted/ }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("offers a way out when nothing matches", async () => {
    const user = userEvent.setup();
    render(panel(tenAccounts()));

    await user.type(screen.getByRole("textbox", { name: "Find an account" }), "nobody");
    expect(screen.queryAllByTestId(/^account-/)).toHaveLength(0);
    expect(screen.getByText("No account matches")).toBeTruthy();
    expect(screen.getByTestId("accounts-range").textContent).toContain("No accounts");

    await user.click(screen.getByRole("button", { name: "Clear the filter" }));
    expect(rowIds()).toHaveLength(8);
  });

  // **The page index is CLAMPED, and the first version of this test did not
  // prove it.** It paged to the end and then clicked a filter — but the filter
  // handler calls `setPage(0)` itself, so the clamp never ran and the test
  // stayed green with the clamp removed. Re-aimed at the path that actually
  // reaches it: the console calls `router.refresh()` after every write, so a
  // shorter `accounts` list can arrive underneath an operator who is on the
  // last page. Without the clamp that renders an empty table while the range
  // line claims rows exist.
  it("clamps to the last real page when the list shrinks underneath it", async () => {
    const user = userEvent.setup();
    const { rerender } = render(panel(tenAccounts()));

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByTestId("accounts-range").textContent).toContain("9–10 of 10");

    rerender(panel(tenAccounts().slice(0, 3)));

    expect(rowIds()).toEqual(["free0", "free1", "free2"]);
    expect(screen.getByTestId("accounts-range").textContent).toContain("1–3 of 3");
  });
  // **The six filters** (M36 link 2). Each id below is chosen so one rule
  // separates it from its neighbours: a payer whose price this deploy cannot
  // read (`null`) still pays; a lapsed subscription is not past due; and
  // *Costs more than it pays* is the server's underwater list, not anything
  // this row's own numbers say.
  function everyKind(): AdminAccountRow[] {
    const paying = { planVersionRef: "plus@v1", paysMicroUsd: 8_000_000, subscriptionState: "active" };
    return [
      ...tenAccounts(),
      account({ userId: "late0", ...paying, subscriptionState: "past_due" }),
      account({ userId: "unpriced0", ...paying, paysMicroUsd: null }),
      // Its own numbers look fine; the server says otherwise, and the server wins.
      account({ userId: "sinking0", ...paying }),
      account({ userId: "lapsed0", subscriptionState: "lapsed" }),
    ];
  }

  it("counts all six filters over the search", async () => {
    const user = userEvent.setup();
    render(panel(everyKind(), { underwater: ["sinking0"] }));

    expect(counts("All")).toBe("14");
    expect(counts("Paying")).toBe("4");
    expect(counts("Granted")).toBe("3");
    expect(counts("Free")).toBe("7");
    expect(counts("Past due")).toBe("1");
    expect(counts("Costs more than it pays")).toBe("1");

    // Searched down, every count follows the search.
    await user.type(screen.getByRole("textbox", { name: "Find an account" }), "late");
    expect(counts("All")).toBe("1");
    expect(counts("Paying")).toBe("1");
    expect(counts("Past due")).toBe("1");
    expect(counts("Costs more than it pays")).toBe("0");
  });

  it("narrows to Past due and to Costs more than it pays", async () => {
    const user = userEvent.setup();
    render(panel(everyKind(), { underwater: ["sinking0"] }));

    await user.click(screen.getByRole("button", { name: /^Past due/ }));
    expect(rowIds()).toEqual(["late0"]);
    await user.click(screen.getByRole("button", { name: /^Costs more than it pays/ }));
    expect(rowIds()).toEqual(["sinking0"]);
  });

  it("draws Asked and Last active from the row", () => {
    render(
      panel([
        account({ userId: "busy", requests: 1234, lastActiveAt: "2026-10-03T09:00:00.000Z" }),
        account({ userId: "idle" }),
      ]),
    );
    const cells = (id: string) =>
      within(screen.getByTestId(`account-${id}`))
        .getAllByRole("cell")
        .map((cell) => cell.textContent);
    expect(cells("busy")).toEqual(expect.arrayContaining(["1,234", "3 days ago"]));
    // Columns 6 and 7 — Asked, Last active — read `—` when there is nothing.
    expect(cells("idle").slice(5, 7)).toEqual(["—", "—"]);
  });

  // **D2: the view is URL state.** Seeded from what the server read off the
  // URL, and written back as it changes — without a navigation, which would
  // re-run the whole overview per keystroke.
  it("starts from the view the URL arrived with", () => {
    render(panel(everyKind(), { initial: { query: "granted", filter: "granted", page: 0 } }));
    expect((screen.getByRole("textbox", { name: "Find an account" }) as HTMLInputElement).value).toBe("granted");
    expect(screen.getByRole("button", { name: /^Granted/ }).getAttribute("aria-pressed")).toBe("true");
    expect(rowIds()).toEqual(["granted0", "granted1", "granted2"]);
    // Seeded, so nothing to write back yet.
    expect(replaceState).not.toHaveBeenCalled();
  });

  // Back and Forward re-render the page with another `initial` and nothing
  // else; the table has to follow it rather than keep the state it seeded.
  it("follows a navigation to a different view", () => {
    const { rerender } = render(panel(everyKind()));
    rerender(panel(everyKind(), { initial: { query: "granted", filter: "granted", page: 0 } }));
    expect(screen.getByRole("button", { name: /^Granted/ }).getAttribute("aria-pressed")).toBe("true");
    expect(rowIds()).toEqual(["granted0", "granted1", "granted2"]);
  });

  it("writes search, filter and page back to the URL as they change", async () => {
    const user = userEvent.setup();
    render(panel(everyKind()));
    const lastUrl = () => replaceState.mock.calls.at(-1)?.[2];

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(lastUrl()).toBe("/admin?tab=users&page=2");
    await user.click(screen.getByRole("button", { name: /^Paying/ }));
    expect(lastUrl()).toBe("/admin?tab=users&filter=paying");
    await user.type(screen.getByRole("textbox", { name: "Find an account" }), "late");
    expect(lastUrl()).toBe("/admin?tab=users&q=late&filter=paying");
    expect(push).not.toHaveBeenCalled();
  });

  // **The whole row opens the account page, with the view kept**, so the
  // account page's *← All accounts* comes back to the same page of the same
  // filter. Ten free accounts searched by "free", on page two of the filter.
  it("links each row to its account, keeping q, filter and page", async () => {
    const user = userEvent.setup();
    const accounts = Array.from({ length: 10 }, (_, i) => account({ userId: `free${i}` }));
    render(panel(accounts, { initial: { query: "free", filter: "unentitled", page: 1 } }));
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
      panel([
        account({
          userId: "comped",
          grantSources: ["admin", "founder"],
          grants: [
            { id: "g1", source: "admin", planVersionRef: "premium@v1", expiresAt: null },
            { id: "g2", source: "founder", planVersionRef: "plus@v1", expiresAt: null },
          ] as AdminAccountRow["grants"],
        }),
      ]),
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
    render(panel([account({ userId: "solo" })]));
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
    render(panel([account({ userId: "solo" })]));
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
