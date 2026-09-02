import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BudgetChip } from "./BudgetChip";

afterEach(cleanup);

// Money renders with the app's one shared formatter (formatMoney.ts, KI-2)
// — grouped 2-decimal amount, currency prefixed as its symbol where one's
// well-known ("$9,085.00", #46). Everywhere else that calls formatMoney
// picks this up automatically, same as it did for KI-2's grouping.
describe("BudgetChip", () => {
  it("shows the planned total, the budget and the remaining badge", () => {
    render(
      <BudgetChip
        spend={{ total: 908_500, unpriced: 0, budget: 1_640_000, remaining: 731_500, over: false }}
        currency="USD"
        onOpenSettings={() => {}}
      />,
    );

    expect(screen.getByText("$9,085.00")).toBeTruthy();
    expect(screen.getByText("of $16,400.00")).toBeTruthy();
    expect(screen.getByText("$7,315.00 left")).toBeTruthy();
  });

  it("reads as over budget with a warning badge", () => {
    render(
      <BudgetChip
        spend={{ total: 1_722_000, unpriced: 0, budget: 1_640_000, remaining: -82_000, over: true }}
        currency="USD"
        onOpenSettings={() => {}}
      />,
    );

    expect(screen.getByText("$820.00 over")).toBeTruthy();
  });

  it("invites setting a budget when there is none", () => {
    render(
      <BudgetChip
        spend={{ total: 0, unpriced: 0, budget: null, remaining: null, over: false }}
        currency="USD"
        onOpenSettings={() => {}}
      />,
    );

    expect(screen.getByText("Set a budget")).toBeTruthy();
  });

  // Mitchell, reviewing the preview: "Budget bar should be full length up to
  // the 'Amount left' element" — not the fixed 132px the handoff mock used.
  it("sizes the moss track to the flex column's own width, not a fixed pixel value", () => {
    const { container } = render(
      <BudgetChip
        spend={{ total: 908_500, unpriced: 0, budget: 1_640_000, remaining: 731_500, over: false }}
        currency="USD"
        onOpenSettings={() => {}}
      />,
    );

    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    const track = container.querySelector(".bg-moss");
    expect(track?.className).toContain("w-full");
    expect((track as HTMLElement | null)?.style.width).toBe("");
  });

  it("opens settings when clicked", async () => {
    const onOpenSettings = vi.fn();
    render(
      <BudgetChip
        spend={{ total: 908_500, unpriced: 0, budget: 1_640_000, remaining: 731_500, over: false }}
        currency="USD"
        onOpenSettings={onOpenSettings}
      />,
    );

    await userEvent.click(screen.getByRole("button"));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });
});
