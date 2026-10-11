import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccountPlanChoice } from "@/lib/accountPlan";
import { formatPrice } from "@/lib/planCopy";
import { LandingScreen } from "./LandingScreen";

// **No price on the front door is typed by hand** (M42's gate: "a test fails
// if a price string is hard-coded in the landing component").
//
// Its own file because the snapshot is replaced for the whole module: the paid
// plans are given prices nobody would type, so a price the page shows that is
// NOT one of them was written into a component rather than read from
// `planVersions.ts` through the snapshot — and it would go on quoting the old
// price the day a new plan version is published. Both trees are checked: the
// phone front door is a separate component with its own copy of the page.
vi.mock("@/lib/landingPlans", async (importOriginal) => {
  const { LANDING_PLANS } = await importOriginal<typeof import("@/lib/landingPlans")>();
  const unlikely: Record<string, number> = { plus: 1234, premium: 5678 };
  return {
    LANDING_PLANS: LANDING_PLANS.map(
      (choice): AccountPlanChoice => ({ ...choice, priceMinor: unlikely[choice.planId] ?? choice.priceMinor }),
    ),
  };
});

afterEach(cleanup);

// Anything reading as a monthly price. The hero's demo trip shows money too
// ("$340"), so a bare amount is not a price; the second assertion covers that.
const PRICE_SHAPED = /[$€£]\s?\d[\d.,]*\s*(\/|a|per)\s*(mo|month)\b/i;

/**
 * Whether `text` names `amount` ("$9") as a whole amount — "$9" or "$9.00",
 * but not "$94" or "$9.50". Plain string search rather than a regex built from
 * the amount, so nothing in it needs escaping.
 */
function namesAmount(text: string, amount: string): boolean {
  for (let at = text.indexOf(amount); at !== -1; at = text.indexOf(amount, at + 1)) {
    let rest = text.slice(at + amount.length);
    if (rest.startsWith(".00")) rest = rest.slice(3);
    if (!/^[\d.,]/.test(rest)) return true;
  }
  return false;
}

describe("the landing page's prices", () => {
  it.each(["desktop-landing", "phone-front-door"])("in %s are the snapshot's, and only those", async (tree) => {
    const { LANDING_PLANS: real } = await vi.importActual<typeof import("@/lib/landingPlans")>("@/lib/landingPlans");
    render(<LandingScreen />);
    const scope = within(screen.getByTestId(tree));

    expect(scope.queryAllByText(PRICE_SHAPED).map((el) => el.textContent)).toEqual([
      "$12.34 / month",
      "$56.78 / month",
    ]);
    // The live prices, in any wording: "$9", "$9.00", "$9 a month".
    for (const { priceMinor, currency } of real) {
      if (priceMinor === null || priceMinor === 0) continue;
      const amount = formatPrice(priceMinor, currency);
      expect(scope.queryAllByText((text) => namesAmount(text, amount))).toEqual([]);
    }
  });
});
