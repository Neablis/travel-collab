import { describe, expect, it } from "vitest";
import { accountsViewHref, resolveAccountsView } from "./accountsView";

describe("the accounts table's URL state", () => {
  it("reads back what it writes", () => {
    const view = { query: "wren", filter: "pastDue", page: 2 } as const;
    const params = Object.fromEntries(new URL(accountsViewHref(view), "http://x").searchParams);
    expect(resolveAccountsView(params)).toEqual(view);
  });

  // A stale or hand-edited link still lands on the table, not an error.
  it("falls back to the defaults for a value it does not know", () => {
    expect(resolveAccountsView({ filter: "free", page: "0" })).toEqual({ query: "", filter: "all", page: 0 });
    expect(resolveAccountsView({ page: "2.5" }).page).toBe(0);
    expect(resolveAccountsView({ filter: ["granted", "paying"] }).filter).toBe("granted");
  });
});
