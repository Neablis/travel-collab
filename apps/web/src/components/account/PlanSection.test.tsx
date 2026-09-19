import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountPlanView } from "@/lib/accountPlan";
import { PlanSection } from "./PlanSection";

// **What a person can READ off this screen, not what the wire carries.**
//
// That rule survives from M20's version of this file, and the reason it was
// written is worth keeping: the wire had carried every plan's ceilings since
// link 7, and a walk of the deployed preview found a person could read exactly
// one plan's. A test that reads the props would have passed against the defect
// it exists to catch.
//
// **What the file is about changed with SPEC §29.** The catalogue left this
// screen for the `plans` route — *"Plans is not a second view of the same
// information"* — so the per-plan assertions moved to `PlansScreen.test.tsx`
// with it. What is left here is what the sheet keeps: plan, version, state, the
// two meters, the past-due copy and the referral row.
//
// **The past-due case is the one that matters most.** It is the only warning
// anyone gets — three days is too short for a gentle notice followed by a firm
// one — and the loss it has to name includes other people's, because M20's
// collaborator cap is applied on read and the owner's guests are never told.

const CATALOGUE: AccountPlanView["catalogue"] = [
  {
    planId: "free",
    version: 1,
    entitlements: [],
    perUserRequestsPerDay: 0,
    perUserStepsPerDay: 0,
    held: true,
    priceMinor: 0,
    currency: "usd",
  },
  {
    planId: "premium",
    version: 1,
    entitlements: ["ai.ask", "ai.command", "trip.collaborators"],
    perUserRequestsPerDay: 200,
    perUserStepsPerDay: 1600,
    held: false,
    priceMinor: 1900,
    currency: "usd",
  },
];

const FREE: AccountPlanView = {
  planVersionRef: "free@v1",
  conferredVersionRef: "free@v1",
  grantedVersionRefs: [],
  entitlements: [],
  questions: { used: 0, limit: 0 },
  steps: { used: 0, limit: 0 },
  catalogue: CATALOGUE,
  referralCode: null,
  canRefer: false,
  billing: {
    state: "none",
    renewsAt: null,
    pastDueSince: null,
    graceEndsAt: null,
    trialEndsAt: null,
    losesOnLapse: [],
    available: true,
  },
};

function subscribed(over: Partial<AccountPlanView["billing"]> = {}): AccountPlanView {
  return {
    ...FREE,
    planVersionRef: "premium@v1",
    conferredVersionRef: "premium@v1",
    entitlements: ["ai.ask", "ai.command", "trip.collaborators"],
    catalogue: CATALOGUE.map((choice) => ({ ...choice, held: choice.planId === "premium" })),
    canRefer: true,
    billing: {
      state: "active",
      renewsAt: "2026-10-20T00:00:00.000Z",
      pastDueSince: null,
      graceEndsAt: null,
      trialEndsAt: null,
      // A paid subscription whose lapse would cost the collaborator seats —
      // the server derives this; the fixture states what it derived.
      losesOnLapse: ["ai.ask", "ai.command", "trip.collaborators"],
      available: true,
      ...over,
    },
  };
}

function serve(plan: AccountPlanView): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ plan }), { status: 200 })),
  );
}

const text = (testId: string) => screen.getByTestId(testId).textContent ?? "";

beforeEach(() => serve(FREE));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("what you hold", () => {
  it("names the plan, the version and the state", async () => {
    serve(subscribed());
    render(<PlanSection />);
    await screen.findByTestId("plan-section");
    expect(text("plan-held")).toContain("premium");
    expect(text("plan-state")).toBe("Active");
  });

  // **"Renews on 20 October" and "ends on 20 October" are the same date and
  // opposite facts**, and a person deciding whether to fix a card is reading
  // for exactly that difference.
  it("says renews for an active plan and ends for a cancelled one", async () => {
    serve(subscribed());
    render(<PlanSection />);
    expect((await screen.findByTestId("plan-renews")).textContent).toContain("Renews on");
    cleanup();

    serve(subscribed({ state: "cancelling" }));
    render(<PlanSection />);
    const ending = await screen.findByTestId("plan-renews");
    expect(ending.textContent).toContain("Ends on");
    expect(ending.textContent).toContain("nothing changes");
  });

  it("sends Change plan to the plans route rather than expanding the sheet", async () => {
    render(<PlanSection />);
    const link = await screen.findByTestId("plan-change-link");
    expect(link.getAttribute("href")).toBe("/plans");
    // The chooser is gone from the sheet: §29's reflow defect was the
    // expanding region, not the copy.
    expect(screen.queryByTestId("plan-chooser")).toBeNull();
    expect(screen.queryByTestId("plan-catalogue")).toBeNull();
  });

  // **The sheet is a modal dialog, so navigating out of it has to close it.**
  // Reported on the preview, 2026-09-15: *"Clicking change plan should navigate
  // to the plans, but also close the sidebar"*. Without this the route changed
  // underneath a dialog that stayed open over the page it had just reached.
  //
  // Asserted as the callback firing rather than as the sheet closing: this
  // component does not own the sheet and must not decide that it closes —
  // `AccountSettingsSheet` passes `() => onOpenChange(false)`.
  it("tells its host to close when Change plan is taken", async () => {
    const onNavigate = vi.fn();
    render(<PlanSection onNavigate={onNavigate} />);
    fireEvent.click(await screen.findByTestId("plan-change-link"));
    expect(onNavigate).toHaveBeenCalledOnce();
  });

  // §29: *"do not offer a CTA that opens a checkout that cannot succeed"*. A
  // deployment with no Stripe keys is legitimate — every local run is one.
  it("offers no billing portal when nothing can be bought on this deployment", async () => {
    serve(subscribed({ available: false }));
    render(<PlanSection />);
    await screen.findByTestId("plan-section");
    expect(screen.queryByTestId("plan-billing-portal")).toBeNull();
  });

  it("offers the portal on a deployment that can", async () => {
    serve(subscribed());
    render(<PlanSection />);
    expect(await screen.findByTestId("plan-billing-portal")).toBeTruthy();
  });
});

describe("past due, told before anything is taken", () => {
  const declined = subscribed({
    state: "past-due",
    pastDueSince: "2026-10-01T09:00:00.000Z",
    graceEndsAt: "2026-10-04T09:00:00.000Z",
  });

  // The three facts M21 link 6 requires, in order: when it was declined, when
  // the window closes, and what stops then.
  it("names the decline date, the deadline and what stops", async () => {
    serve(declined);
    render(<PlanSection />);
    const banner = await screen.findByTestId("plan-past-due");
    expect(banner.textContent).toContain("October 1");
    expect(banner.textContent).toContain("October 4");
    expect(banner.textContent).toContain("assistant stops");
  });

  // **Naming the loss beats announcing it**, and the loss here is partly other
  // people's: M20's cap drops collaborators to `viewer` on read, and nobody
  // tells them because it is not their account.
  it("names the collaborators, because nobody else will tell them", async () => {
    serve(declined);
    render(<PlanSection />);
    expect((await screen.findByTestId("plan-past-due")).textContent).toContain(
      "everyone else on your trips goes back to reading",
    );
  });

  // Inside the window NOTHING has been lost, and the copy has to say so or a
  // person reads it as an outage they have already suffered.
  it("says nothing has changed yet", async () => {
    serve(declined);
    render(<PlanSection />);
    expect((await screen.findByTestId("plan-past-due")).textContent).toContain(
      "Nothing has changed yet",
    );
  });

  it("switches to what was actually lost once the window has closed", async () => {
    serve(subscribed({ state: "lapsed", pastDueSince: "2026-10-01T09:00:00.000Z" }));
    render(<PlanSection />);
    const banner = await screen.findByTestId("plan-lapsed");
    expect(banner.textContent).toContain("lapsed");
    expect(banner.textContent).toContain("nobody needs re-inviting");
    expect(screen.queryByTestId("plan-past-due")).toBeNull();
  });

  // **The lapsed banner still names the collaborators after the lapse has been
  // applied**, which is the case the test above does NOT reach.
  //
  // The fixture above leaves `conferredVersionRef` at `premium@v1` and keeps
  // `trip.collaborators` in `entitlements` — a lapse in `billing.state` only.
  // The real post-lapse account is conferred `free@v1` with the collaborator
  // entitlement gone, and that is the shape the old code read: it asked
  // `plan.entitlements`, the RESOLVED set, so the moment the lapse actually
  // took collaborators away the banner explaining that loss stopped mentioning
  // it. The sentence went quiet exactly when it mattered.
  //
  // The held version is the honest source — it is what the subscription buys
  // and therefore what stopping it takes — and this is the assertion that
  // distinguishes the two. CodeRabbit, PR #177.
  it("names the collaborator loss even once the lapse has taken it away", async () => {
    const lapsed = subscribed({ state: "lapsed", pastDueSince: "2026-10-01T09:00:00.000Z" });
    serve({
      ...lapsed,
      // Still PINNED to premium — the account pays for it — but conferred free,
      // with the entitlement already gone from the effective set. That is the
      // shape the old code misread.
      conferredVersionRef: "free@v1",
      entitlements: [],
    });
    render(<PlanSection />);
    const banner = await screen.findByTestId("plan-lapsed");
    expect(banner.textContent).toContain("can read but not edit");
    expect(banner.textContent).toContain("nobody needs re-inviting");
  });

  // And the other direction, so the sentence is not simply always shown: an
  // account whose HELD plan never included collaborators gets the shorter
  // copy, with no claim about other people that was never true of it.
  it("says nothing about collaborators for a plan that never had them", async () => {
    const lapsed = subscribed({ state: "lapsed", pastDueSince: "2026-10-01T09:00:00.000Z" });
    serve({
      ...lapsed,
      planVersionRef: "free@v1",
      conferredVersionRef: "free@v1",
      entitlements: [],
      billing: { ...lapsed.billing, losesOnLapse: [] },
      catalogue: CATALOGUE.map((choice) => ({ ...choice, held: choice.planId === "free" })),
    });
    render(<PlanSection />);
    const banner = await screen.findByTestId("plan-lapsed");
    expect(banner.textContent).toContain("lapsed");
    expect(banner.textContent).not.toContain("can read but not edit");
  });

  // **A grant that outlives the subscription means nothing was lost** — the
  // case CodeRabbit asked for after rejecting "conservative but wrong", and it
  // is the common one here: every account predating M20's migration carries a
  // permanent founder grant.
  //
  // The account below held `premium`, its subscription has lapsed, and the
  // grant still confers `trip.collaborators`. Its collaborators can still edit.
  // A banner saying they went read-only would be telling this owner their trips
  // broke when they did not — and pointing them at a payment to fix it.
  //
  // `losesOnLapse` is empty because the SERVER worked that out; the fixture is
  // stating what `entitlementsLostIfSubscriptionStops` returns for this shape,
  // not restating the rule.
  it("claims no collaborator loss when a grant still confers it", async () => {
    const lapsed = subscribed({ state: "lapsed", pastDueSince: "2026-10-01T09:00:00.000Z" });
    serve({
      ...lapsed,
      conferredVersionRef: "free@v1",
      // Still conferred — by the grant, not by the subscription.
      entitlements: ["trip.collaborators"],
      billing: { ...lapsed.billing, losesOnLapse: [] },
    });
    render(<PlanSection />);
    const banner = await screen.findByTestId("plan-lapsed");
    expect(banner.textContent).toContain("lapsed");
    expect(banner.textContent).not.toContain("can read but not edit");
  });
});

describe("a free week", () => {
  // **The state every brand-new account is in**, and the one with no renewal
  // date — a trial is a grant, so `renewsAt` is null and the renewal line was
  // simply absent. A browser walk of the preview found the badge saying "Free
  // week" with nothing anywhere saying when the week ended.
  it("says when it ends and what happens after", async () => {
    serve({
      ...FREE,
      entitlements: ["ai.ask", "ai.command"],
      billing: { ...FREE.billing, state: "trial", trialEndsAt: "2026-09-22T00:00:00.000Z" },
    });
    render(<PlanSection />);
    const line = await screen.findByTestId("plan-trial-ends");
    expect(line.textContent).toContain("September 22");
    expect(line.textContent).toContain("free v1");
  });
});

describe("the referral row", () => {
  // M21 link 5: *"a `free` or trial-only account has no referral row at all,
  // because it earns nothing"* — offering a reward that resolves to zero.
  it("is absent for an account that earns nothing", async () => {
    render(<PlanSection />);
    await screen.findByTestId("plan-section");
    expect(screen.queryByTestId("referral-row")).toBeNull();
  });

  it("is present for an account that holds a tier worth a month", async () => {
    serve(subscribed());
    render(<PlanSection />);
    expect(await screen.findByTestId("referral-row")).toBeTruthy();
  });
});

describe("the meters", () => {
  it("shows both ceilings, because steps is what binds first on a heavy day", async () => {
    serve({ ...subscribed(), questions: { used: 3, limit: 200 }, steps: { used: 40, limit: 1600 } });
    render(<PlanSection />);
    await screen.findByTestId("plan-section");
    expect(text("meter-questions")).toContain("3 / 200");
    expect(text("meter-steps")).toContain("40 / 1600");
  });
});

// **The tier an account can actually use is not always the one it bought.**
// Mitchell's own founding account, 2026-09-19: `users.plan_id` said `plus@v1`,
// two permanent `premium` grants sat active on it, and the sheet never once
// printed the word `premium` — so the screen disagreed with what the assistant
// and the collaborator cap were actually letting through. `entitlements` was
// already the union; what was missing was a TIER a person recognises.
describe("a grant above the held plan", () => {
  const comped = (): AccountPlanView => ({
    ...FREE,
    planVersionRef: "plus@v1",
    conferredVersionRef: "plus@v1",
    // What the operator console writes for a comp: a grant pinned to its own
    // version, which outlives the plan the account pays for.
    grantedVersionRefs: ["premium@v1", "premium@v2"],
    entitlements: ["ai.ask", "ai.command", "trip.collaborators", "api.tokens"],
    catalogue: CATALOGUE.map((choice) => ({ ...choice, held: choice.planId === "plus" })),
  });

  it("shows the granted tier, not the bought one", async () => {
    serve(comped());
    render(<PlanSection />);
    await screen.findByTestId("plan-section");
    // The newest granted version of the most capable granted plan.
    expect(text("plan-effective")).toContain("premium");
    expect(text("plan-effective")).toContain("2");
  });

  // Both facts, because the billing copy below the card is about the
  // SUBSCRIPTION: an account reading only "premium" would have no way to
  // understand a renewal notice naming `plus`.
  it("still names the plan that was actually bought", async () => {
    serve(comped());
    render(<PlanSection />);
    await screen.findByTestId("plan-section");
    expect(text("plan-held")).toContain("plus");
  });

  // The guard against the reverse failure: with no grant, the label is the held
  // plan and nothing invents a tier.
  it("leaves an ungranted account on its own plan", async () => {
    serve(subscribed());
    render(<PlanSection />);
    await screen.findByTestId("plan-section");
    expect(text("plan-effective")).toContain("premium");
    expect(text("plan-held")).toContain("premium");
  });

  // A plan the chooser does not offer (`studio` ships disabled) must never
  // become the label — there is no page that could explain it.
  it("ignores a grant for a plan the catalogue does not offer", async () => {
    serve({ ...comped(), grantedVersionRefs: ["studio@v1"] });
    render(<PlanSection />);
    await screen.findByTestId("plan-section");
    expect(text("plan-effective")).toContain("plus");
  });
});
