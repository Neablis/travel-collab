import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountPlanView } from "@/lib/accountPlan";
import { PlanSection } from "./PlanSection";

// **What a person can READ off this screen, not what the wire carries.**
//
// M20's gate box asks the plan chooser for "every enabled plan, its
// entitlements and its ceilings". The wire has carried all of it since link 7
// — `perUserRequestsPerDay` AND `perUserStepsPerDay`, for every catalogue
// entry — and a walk of the deployed preview (2026-09-14) found a person could
// read the entitlements of exactly one plan, the one they already hold, and
// the steps ceiling of none: the description was rendered for the SELECTED
// plan, and the select lives inside a `<Preview>` whose shield means it can
// never be changed.
//
// That is why this test asserts per-plan text rather than asserting the
// component "received the catalogue". A test that reads the props would have
// passed against the defect it exists to catch, which is the whole lesson of
// the three tests this repo caught asserting nothing.
//
// The steps ceiling is asserted for EVERY plan, including `free`'s explicit
// zero. `free` publishes 0·0 rather than null on purpose (`planVersions.ts`):
// a version naming no ceiling falls through to the environment's default, so
// "no assistant" and "no ceiling named" must not print the same way.

const CATALOGUE: AccountPlanView["catalogue"] = [
  {
    planId: "free",
    version: 1,
    entitlements: [],
    perUserRequestsPerDay: 0,
    perUserStepsPerDay: 0,
    held: true,
  },
  {
    planId: "plus",
    version: 1,
    entitlements: ["ai.ask", "ai.command"],
    perUserRequestsPerDay: 50,
    perUserStepsPerDay: 400,
    held: false,
  },
  {
    planId: "premium",
    version: 1,
    entitlements: ["ai.ask", "ai.command", "trip.collaborators"],
    perUserRequestsPerDay: 200,
    perUserStepsPerDay: 1600,
    held: false,
  },
];

const VIEW: AccountPlanView = {
  planVersionRef: "free@v1",
  entitlements: [],
  questions: { used: 0, limit: 0 },
  steps: { used: 0, limit: 0 },
  catalogue: CATALOGUE,
  referralCode: null,
};

function serve(plan: AccountPlanView): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ plan }), { status: 200 })),
  );
}

/** The rendered text of one offer. This repo has no jest-dom, so text is read
 * off the node rather than asserted with `toHaveTextContent`. */
function text(testId: string): string {
  return screen.getByTestId(testId).textContent ?? "";
}

beforeEach(() => {
  serve(VIEW);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the plan catalogue", () => {
  it("names every enabled plan, whatever the account holds", async () => {
    render(<PlanSection />);
    const catalogue = await screen.findByTestId("plan-catalogue");

    for (const choice of CATALOGUE) {
      expect(within(catalogue).getByTestId(`plan-offer-${choice.planId}`)).toBeTruthy();
    }
  });

  it("shows each plan's entitlements, not only the held plan's", async () => {
    render(<PlanSection />);
    await screen.findByTestId("plan-catalogue");

    // premium is not held and cannot be selected — the select is inside a
    // Preview shield — so this text is unreachable unless it is rendered for
    // every plan up front.
    expect(text("plan-offer-premium")).toContain("ai.ask, ai.command, trip.collaborators.");
    expect(text("plan-offer-plus")).toContain("ai.ask, ai.command.");
    expect(text("plan-offer-free")).toContain("No assistant, no one else");
  });

  it("shows BOTH ceilings for every plan, steps included", async () => {
    render(<PlanSection />);
    await screen.findByTestId("plan-catalogue");

    expect(text("plan-offer-premium")).toContain("200 questions and 1600 steps a day.");
    expect(text("plan-offer-plus")).toContain("50 questions and 400 steps a day.");
    expect(text("plan-offer-free")).toContain("0 questions and 0 steps a day.");
  });

  it("says a version naming no ceiling differently from one selling zero", async () => {
    serve({
      ...VIEW,
      catalogue: [
        { ...CATALOGUE[0]!, perUserRequestsPerDay: null, perUserStepsPerDay: null },
        ...CATALOGUE.slice(1),
      ],
    });
    render(<PlanSection />);
    await screen.findByTestId("plan-catalogue");

    expect(text("plan-offer-free")).toContain("No ceiling of its own");
    expect(text("plan-offer-free")).not.toContain("0 questions");
  });

  it("marks the held plan and no other", async () => {
    render(<PlanSection />);
    await screen.findByTestId("plan-catalogue");

    expect(text("plan-offer-free")).toContain("what you hold");
    expect(text("plan-offer-plus")).not.toContain("what you hold");
    expect(text("plan-offer-premium")).not.toContain("what you hold");
  });

  it("carries no price for any plan", async () => {
    render(<PlanSection />);
    const catalogue = await screen.findByTestId("plan-catalogue");

    expect(catalogue.textContent ?? "").not.toMatch(/[$€£]\s?\d|\d+\s?(?:USD|EUR|GBP)|\/mo\b|per month/i);
  });
});
