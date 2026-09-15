import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

// **No `@testing-library/jest-dom` in this repo**, deliberately — assertions
// read the DOM property rather than a matcher that wraps it.
import type { AdminAccountRow } from "@/lib/adminOverview";

// `GrantDialog` and `GrantList` both reach the network on interaction and
// neither is what these tests are about — this file is the search, the counted
// filters, the page window and the no-match state, which the design specifies
// and the first build of the console shipped without.
vi.mock("@/components/admin/GrantDialog", () => ({
  GrantDialog: ({ userId }: { userId: string }) => <span>grant:{userId}</span>,
}));
vi.mock("@/components/admin/GrantList", () => ({ GrantList: () => <span>grants</span> }));

import { AccountsPanel } from "./AccountsPanel";

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
    paysMicroUsd: 0,
    subscriptionState: null,
    ...over,
  };
}

/** Ten accounts: six free, four on a paid plan, three of those granted. */
function tenAccounts(): AdminAccountRow[] {
  return [
    ...Array.from({ length: 6 }, (_, i) => account({ userId: `free${i}` })),
    account({ userId: "paid0", planVersionRef: "plus@v1" }),
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

afterEach(cleanup);

describe("AccountsPanel", () => {
  it("shows one page of eight and pages through the rest", async () => {
    const user = userEvent.setup();
    render(<AccountsPanel accounts={tenAccounts()} plans={["plus"]} plansGrantingNothing={["free"]} windowDays={30} />);

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
    render(<AccountsPanel accounts={accounts} plans={["plus"]} plansGrantingNothing={["free"]} windowDays={30} />);

    await user.type(screen.getByRole("textbox", { name: "Find an account" }), "wren");
    expect(rowIds()).toEqual(["opaque-id-1"]);
  });

  it("falls back to the account id when a row has no address", async () => {
    const user = userEvent.setup();
    const accounts = [...tenAccounts(), account({ userId: "no-address-1", email: null })];
    render(<AccountsPanel accounts={accounts} plans={["plus"]} plansGrantingNothing={["free"]} windowDays={30} />);

    await user.type(screen.getByRole("textbox", { name: "Find an account" }), "no-address");
    expect(rowIds()).toEqual(["no-address-1"]);
  });

  it("counts each filter over the whole matching set, not the page", async () => {
    render(<AccountsPanel accounts={tenAccounts()} plans={["plus"]} plansGrantingNothing={["free"]} windowDays={30} />);

    // Ten rows, eight of them visible — a count taken from the page would read
    // 8/…/6 here rather than 10/4/3/6.
    const counts = (name: string) =>
      within(screen.getByRole("button", { name: new RegExp(`^${name}`) })).getByText(/^\d+$/)
        .textContent;
    expect(counts("All")).toBe("10");
    expect(counts("Holds a paid plan")).toBe("4");
    expect(counts("Granted")).toBe("3");
    expect(counts("Free")).toBe("6");
  });

  it("narrows the table to the chosen filter", async () => {
    const user = userEvent.setup();
    render(<AccountsPanel accounts={tenAccounts()} plans={["plus"]} plansGrantingNothing={["free"]} windowDays={30} />);

    await user.click(screen.getByRole("button", { name: /^Granted/ }));
    expect(rowIds()).toEqual(["granted0", "granted1", "granted2"]);
    expect(
      screen.getByRole("button", { name: /^Granted/ }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("offers a way out when nothing matches", async () => {
    const user = userEvent.setup();
    render(<AccountsPanel accounts={tenAccounts()} plans={["plus"]} plansGrantingNothing={["free"]} windowDays={30} />);

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
    const { rerender } = render(
      <AccountsPanel accounts={tenAccounts()} plans={["plus"]} plansGrantingNothing={["free"]} windowDays={30} />,
    );

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByTestId("accounts-range").textContent).toContain("9–10 of 10");

    rerender(
      <AccountsPanel accounts={tenAccounts().slice(0, 3)} plans={["plus"]} plansGrantingNothing={["free"]} windowDays={30} />,
    );

    expect(rowIds()).toEqual(["free0", "free1", "free2"]);
    expect(screen.getByTestId("accounts-range").textContent).toContain("1–3 of 3");
  });
});
