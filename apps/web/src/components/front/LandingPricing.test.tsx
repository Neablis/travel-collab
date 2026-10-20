import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { AccountPlanChoice } from "@/lib/accountPlan";
import { LANDING_PLANS } from "@/lib/landingPlans";
import { LandingPricing, ladder } from "./LandingPricing";

afterEach(cleanup);

const plan = (planId: string) => LANDING_PLANS.find((choice) => choice.planId === planId)!;
const steps = (plans: readonly AccountPlanChoice[]) =>
  Object.fromEntries(ladder(plans).map((step) => [step.choice.planId, step.base?.planId ?? null]));

// M51 decision 6: the front door's pricing is a ladder, each step "Everything
// in Free/Plus, and…". A plan is a set, not a rank (M20), so the step below a
// plan is the largest plan whose entitlements it holds, never the cheaper one
// or the one before it: the day a plan stops nesting, the ladder stops saying
// it does (`planVersions.noExtension.test.ts`'s warning).
describe("the pricing ladder", () => {
  it("steps each plan from the largest plan it contains, whatever the prices and the order", () => {
    const shuffled = [
      { ...plan("premium"), priceMinor: 100 },
      { ...plan("free"), priceMinor: 5000 },
      { ...plan("plus"), priceMinor: 0 },
    ];
    expect(steps(shuffled)).toEqual({ free: null, plus: "free", premium: "plus" });
  });

  it("steps a plan that stopped nesting from what it still contains", () => {
    const crewOnly = { ...plan("premium"), entitlements: ["trip.collaborators"] };
    expect(steps([plan("free"), plan("plus"), crewOnly])).toEqual({ free: null, plus: "free", premium: "free" });
  });

  it("reads decision 6's lines", () => {
    render(<LandingPricing />);
    const summary = within(screen.getByTestId("plan-summary"));
    expect(summary.getByText("Every trip you want, as many days as you like — and share any of it with a link.")).toBeDefined();
    const lines = summary.getAllByTestId("plan-step").map((line) => line.textContent);
    expect(lines).toEqual([
      "Everything in Free, and your personal AI trip assistant.",
      "Everything in Plus, and bring the whole crew in; only you need it.",
    ]);
    expect(screen.getByRole("region", { name: "Pricing" }).textContent).not.toMatch(/!/);
  });
});
