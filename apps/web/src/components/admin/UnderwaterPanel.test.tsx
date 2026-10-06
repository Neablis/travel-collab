import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { AdminUnderwaterView } from "@/lib/adminOverview";
import { UnderwaterPanel } from "./UnderwaterPanel";

afterEach(cleanup);

const report = (paying: AdminUnderwaterView["paying"]): AdminUnderwaterView => ({
  paying,
  grantFunded: [],
  windowDays: 30,
});

describe("the underwater panel", () => {
  // **Show them in Users lands on the accounts filter for the same set**
  // (M36 link 2) — the rows are listed once, in the table an account opens from.
  it("links the paying-and-underwater count to the Users filter", () => {
    render(
      <UnderwaterPanel
        report={report([{ userId: "u1", paysMicroUsd: 8_000_000, costMicroUsd: 9_000_000, marginMicroUsd: -1_000_000 }])}
      />,
    );
    expect(screen.getByRole("link", { name: "Show them in Users" }).getAttribute("href")).toBe(
      "/admin?tab=users&filter=underwater",
    );
  });

  it("offers no link when nobody is underwater", () => {
    render(<UnderwaterPanel report={report([])} />);
    expect(screen.queryByRole("link", { name: "Show them in Users" })).toBeNull();
  });
});
