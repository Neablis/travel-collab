import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LANDING_PLANS } from "@/lib/landingPlans";
import { PlanComparison, planPitch } from "./PlanComparison";

afterEach(cleanup);

describe("planPitch", () => {
  // Mitchell, 2026-10-11: the front door says one thing per plan. Each line is
  // read off what the plan grants, so it has to say something different for
  // every plan the landing shows, and say nothing the copy rules refuse.
  it("gives every published plan its own line, and none of them says free", () => {
    const lines = LANDING_PLANS.map(planPitch);
    expect(new Set(lines).size).toBe(LANDING_PLANS.length);
    for (const line of lines) expect(line).not.toMatch(/\bfree\b/i);
  });

  it("says what each plan is actually for", () => {
    expect(Object.fromEntries(LANDING_PLANS.map((choice) => [choice.planId, planPitch(choice)]))).toEqual({
      free: "Unlimited planned trips",
      plus: "AI tools to help plan the trip",
      premium: "Invite all your friends to come along",
    });
  });
});

describe("PlanComparison", () => {
  // Mitchell, 2026-10-11: on a phone every plan is readable without a sideways
  // swipe. The table stays at `md` and up; below it each plan is a card holding
  // every row of the table. Which one is on screen is CSS, and
  // `m21-plans.spec.ts` measures that; this proves the cards carry the rows.
  it("draws one card per plan, carrying each row's value", () => {
    render(<PlanComparison catalogue={LANDING_PLANS} />);
    const comparison = within(screen.getByTestId("plan-comparison"));
    for (const choice of LANDING_PLANS) {
      const card = within(comparison.getByRole("group", { name: choice.planId }));
      expect(card.getByText("Invite friends to your trips")).toBeTruthy();
      expect(card.getByText("Price")).toBeTruthy();
    }
    const premium = within(comparison.getByRole("group", { name: "premium" }));
    expect(premium.getByText("$19 / month")).toBeTruthy();
    expect(premium.getByText("200")).toBeTruthy();
  });
});
