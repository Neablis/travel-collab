import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { AdminPlanPanelRow, AdminPlanVersionView } from "@/lib/adminOverview";
import { TierPanel } from "./TierPanel";

afterEach(cleanup);

// The ladder field is left off, and the cast says so: the panel never reads it,
// and `planVersions.noExtension.test.ts` refuses any file outside an exact
// allowlist that names it — a fixture included.
const version = (over: Partial<AdminPlanVersionView> & Pick<AdminPlanVersionView, "planId">) =>
  ({
    version: 1,
    entitlements: [],
    ceilings: { perUserRequestsPerDay: null, perUserStepsPerDay: null, maxTier: null },
    price: null,
    publishedAt: "2026-09-13",
    enabled: true,
    ...over,
  }) as AdminPlanVersionView;

/** The wire's order, which is the plan file's: free, then plus, then premium. */
function plans(): AdminPlanPanelRow[] {
  const free = version({ planId: "free", price: { minor: 0, currency: "usd", stripePriceId: null } });
  const plus = version({
    planId: "plus",
    entitlements: ["ai.ask", "ai.command"],
    price: { minor: 900, currency: "usd", stripePriceId: null },
  });
  const premium1 = version({
    planId: "premium",
    entitlements: ["ai.ask", "ai.command", "trip.collaborators"],
    price: { minor: 1900, currency: "usd", stripePriceId: null },
  });
  const premium2 = { ...premium1, version: 2, publishedAt: "2026-09-16" };
  return [
    { planId: "free", versions: [free], live: free, accounts: 40, holdsByVersion: { 1: 40 }, medianMicroUsd: null, mrrMicroUsd: 0, medianMarginMicroUsd: null },
    { planId: "plus", versions: [plus], live: plus, accounts: 7, holdsByVersion: { 1: 7 }, medianMicroUsd: 2_100, mrrMicroUsd: 63_000_000, medianMarginMicroUsd: 8_500_000 },
    {
      planId: "premium",
      versions: [premium1, premium2],
      live: premium2,
      accounts: 3,
      holdsByVersion: { 1: 1, 2: 2 },
      medianMicroUsd: 5_000,
      mrrMicroUsd: 57_000_000,
      medianMarginMicroUsd: 18_000_000,
    },
  ];
}

const panel = () => screen.getByTestId("tier-panel");

describe("how each tier is doing, one tier per tab", () => {
  it("opens on the first paid tier, with its own numbers and versions", () => {
    render(<TierPanel plans={plans()} />);
    const tabs = within(panel()).getAllByRole("tab").map((tab) => tab.textContent);
    expect(tabs).toEqual(["premium", "plus", "free"]);

    const premium = screen.getByTestId("plan-premium");
    expect(within(premium).getByTestId("tier-price").textContent).toBe("$19.00 / month");
    expect(within(premium).getByTestId("tier-grants").textContent).toBe(
      "Grants ai.ask · ai.command · trip.collaborators",
    );
    expect(within(premium).getByTestId("tier-accounts").textContent).toBe("3");
    expect(within(premium).getByTestId("tier-mrr").textContent).toBe("$57.00");
    // Newest first, the live one marked, each with its own holders.
    const cells = (testId: string) =>
      within(within(premium).getByTestId(testId)).getAllByRole("cell").map((cell) => cell.textContent);
    expect(within(premium).getAllByRole("row").slice(1).map((row) => row.dataset.testid)).toEqual([
      "plan-premium-v2",
      "plan-premium-v1",
    ]);
    expect(cells("plan-premium-v2")).toEqual(["v2 · live", "$19.00 / month", "2026-09-16", "2"]);
    expect(cells("plan-premium-v1")).toEqual(["v1", "$19.00 / month", "2026-09-13", "1"]);
    expect(screen.queryByTestId("plan-plus")).toBeNull();
  });

  it("shows another tier's numbers when its tab is picked", async () => {
    render(<TierPanel plans={plans()} />);
    await userEvent.click(within(panel()).getByRole("tab", { name: "plus" }));
    expect(screen.queryByTestId("plan-premium")).toBeNull();
    const plus = screen.getByTestId("plan-plus");
    expect(within(plus).getByTestId("tier-price").textContent).toBe("$9.00 / month");
    expect(within(plus).getByTestId("tier-accounts").textContent).toBe("7");
    expect(within(plus).getByTestId("tier-mrr").textContent).toBe("$63.00");
    expect(within(plus).getByTestId("tier-median-margin").textContent).toBe("+$8.50");
    expect(within(plus).getByTestId("plan-plus-v1").textContent).toContain("v1 · live");
  });

  // ADR-045 rule 4: the sentence follows the empty set, not the plan's name.
  // The grant-nothing plan here is deliberately NOT called free, so a
  // name-based shortcut would fail this.
  it("says 'Planning only' for a live version that grants nothing, whatever it is called", async () => {
    const rows = plans();
    rows[1] = { ...rows[1]!, live: { ...rows[1]!.live, entitlements: [] } };
    render(<TierPanel plans={rows} />);
    await userEvent.click(within(panel()).getByRole("tab", { name: "plus" }));
    expect(screen.getByTestId("tier-grants").textContent).toBe(
      "Planning only — no ai.*, no collaborators",
    );
    await userEvent.click(within(panel()).getByRole("tab", { name: "free" }));
    expect(screen.getByTestId("tier-price").textContent).toBe("free");
  });

  // The plan file's fourth plan is last on the wire and so first in the strip,
  // and it is not sold — opening on it would show an operator a tier nobody
  // can be on.
  it("skips a tier that is not sold when choosing where to open", () => {
    const studio = version({ planId: "studio", enabled: false, entitlements: ["ai.ask", "trip.collaborators"] });
    const rows = [
      ...plans(),
      { planId: "studio" as const, versions: [studio], live: studio, accounts: 0, holdsByVersion: { 1: 0 }, medianMicroUsd: null, mrrMicroUsd: 0, medianMarginMicroUsd: null },
    ];
    render(<TierPanel plans={rows} />);
    expect(within(panel()).getAllByRole("tab")[0]!.textContent).toBe("studio");
    expect(screen.getByTestId("plan-premium")).toBeTruthy();
  });

  it("offers no control but the tabs: versions are published from the repo", () => {
    render(<TierPanel plans={plans()} />);
    expect(within(panel()).queryAllByRole("button")).toHaveLength(0);
    expect(panel().textContent).toContain("Read-only. Versions are published from the repo, not from here.");
  });
});
