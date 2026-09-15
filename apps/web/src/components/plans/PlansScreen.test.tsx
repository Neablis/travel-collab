import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountPlanView } from "@/lib/accountPlan";
import { PlansScreen } from "./PlansScreen";

// **The route SPEC §29 makes of the chooser**, and the three things it is most
// likely to get wrong:
//
//   1. **Reading the table as a ranking.** Column order is display metadata
//      (§29, §17, and M20's most load-bearing rule). A pricing page is exactly
//      where a ladder gets baked in, because a ladder is what a buyer is
//      looking for — so the per-plan assertions here read each plan's OWN
//      contents, and one of them proves a `—` is an absence rather than a
//      cross.
//   2. **Believing the redirect.** *A redirect is a hint, never a grant*
//      (M21 link 4). Returning from Stripe lands on a pending state that waits
//      for the webhook, and this file asserts that the success state is NOT
//      reachable by coming back from a URL.
//   3. **Charging a stale amount.** A publish while someone is on the confirm
//      step is a conflict, not an error: re-render with the new numbers and say
//      so. Never charge the old amount silently.

const search = new URLSearchParams();
vi.mock("next/navigation", () => ({ useSearchParams: () => search }));

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
    planId: "plus",
    version: 1,
    entitlements: ["ai.ask", "ai.command"],
    perUserRequestsPerDay: 50,
    perUserStepsPerDay: 400,
    held: false,
    priceMinor: 900,
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

const VIEW: AccountPlanView = {
  planVersionRef: "free@v1",
  conferredVersionRef: "free@v1",
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
    available: true,
  },
};

const PREVIEW = {
  kind: "first-purchase" as const,
  planId: "plus",
  planVersionRef: "plus@v1",
  currency: "usd",
  lines: [{ description: "plus — one month", minor: 900, proration: false }],
  dueTodayMinor: 900,
  effectiveAt: null,
  cardOnFile: null,
};

interface Routes {
  plan?: AccountPlanView;
  preview?: unknown;
  previewStatus?: number;
  change?: unknown;
  changeStatus?: number;
}

function serve(routes: Routes = {}) {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url.startsWith("/api/account/plan")) {
      return new Response(JSON.stringify({ plan: routes.plan ?? VIEW }), { status: 200 });
    }
    if (url.startsWith("/api/billing/change") && (init?.method ?? "GET") === "GET") {
      return new Response(JSON.stringify({ preview: routes.preview ?? PREVIEW }), {
        status: routes.previewStatus ?? 200,
      });
    }
    return new Response(JSON.stringify(routes.change ?? { kind: "checkout", url: "https://stripe.test/pay" }), {
      status: routes.changeStatus ?? 200,
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

beforeEach(() => {
  search.delete("checkout");
  serve();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the chooser", () => {
  it("names every enabled plan with its own price", async () => {
    render(<PlansScreen />);
    await screen.findByTestId("plan-cards");
    expect(screen.getByTestId("plan-card-free").textContent).toContain("Free");
    expect(screen.getByTestId("plan-card-plus").textContent).toContain("$9");
    expect(screen.getByTestId("plan-card-premium").textContent).toContain("$19");
  });

  // **Each plan enumerates its own contents in full, never "everything in
  // Plus".** The bullets are built from each plan's own entitlements, so a plan
  // that stopped nesting would render correctly with no edit here — which is
  // the property, not the wording.
  it("enumerates each plan's own contents rather than referring to another's", async () => {
    render(<PlansScreen />);
    const premium = within(await screen.findByTestId("plan-card-premium"));
    expect(premium.getByText(/200 questions and 1600 steps a day/)).toBeTruthy();
    expect(premium.getByText(/Other people editing your trips/)).toBeTruthy();
    for (const card of ["plan-card-free", "plan-card-plus", "plan-card-premium"]) {
      expect(screen.getByTestId(card).textContent).not.toMatch(/everything in/i);
    }
  });

  // §29: *"the held card is the only emphasised one, and its CTA is disabled
  // reading 'What you hold'"*.
  it("disables the held plan's own button", async () => {
    render(<PlansScreen />);
    const held = await screen.findByTestId("plan-choose-free");
    expect(held.hasAttribute("disabled")).toBe(true);
    expect(held.textContent).toContain("What you hold");
  });

  // **A `—` is an absence, not a cross**, and no cell reads "not included in
  // your plan". The only comparison on the page is the one the reader makes.
  it("shows an absence as a dash and never as a judgement", async () => {
    render(<PlansScreen />);
    const table = await screen.findByTestId("plan-comparison");
    expect(table.textContent).toContain("—");
    expect(table.textContent).not.toMatch(/not included|✗|✕/i);
  });

  // **Read as a sentence, not as a substring.** The old assertion was
  // `toContainText("free")`, which "You are on free — Free, free." satisfies —
  // and that is what the screen actually said until a browser walk read it.
  it("states the held plan in a sentence a person can read", async () => {
    render(<PlansScreen />);
    const line = (await screen.findByTestId("plans-held-line")).textContent ?? "";
    expect(line).toBe("You are on free, at no charge.");
    // Nothing to prorate on a plan that costs nothing, so nothing says so.
    expect(line).not.toContain("prorated");
  });

  it("says when a free week ends, on the one screen that decides whether to buy", async () => {
    serve({
      plan: {
        ...VIEW,
        entitlements: ["ai.ask", "ai.command"],
        billing: { ...VIEW.billing, state: "trial", trialEndsAt: "2026-09-22T00:00:00.000Z" },
      },
    });
    render(<PlansScreen />);
    const line = (await screen.findByTestId("plans-held-line")).textContent ?? "";
    expect(line).toContain("September 22");
    expect(line).toContain("free week");
  });

  // **Two surfaces, one click apart, saying opposite things.** The account
  // sheet tells a trialling account "Questions 0 / 50"; this page's `free` card
  // says "No assistant". Both are true — one is the resolved union, the other
  // is the plan as published — and a browser walk found that a person has no
  // way to tell that from the screen.
  it("says so when a grant gives more than the held plan lists", async () => {
    serve({
      plan: {
        ...VIEW,
        entitlements: ["ai.ask", "ai.command"],
        billing: { ...VIEW.billing, state: "trial", trialEndsAt: "2026-09-22T00:00:00.000Z" },
      },
    });
    render(<PlansScreen />);
    const note = await screen.findByTestId("plans-grant-note");
    expect(note.textContent).toContain("as published");
  });

  it("carries no such disclaimer when nothing is granted", async () => {
    render(<PlansScreen />);
    await screen.findByTestId("plan-cards");
    expect(screen.queryByTestId("plans-grant-note")).toBeNull();
  });

  // §29's unavailable case: show the held plan and a warning, and do not offer
  // a CTA that opens a checkout which cannot succeed.
  it("offers nothing to buy when billing is unavailable, and says why", async () => {
    serve({ plan: { ...VIEW, billing: { ...VIEW.billing, available: false } } });
    render(<PlansScreen />);
    expect(await screen.findByTestId("plans-unavailable")).toBeTruthy();
    expect(screen.getByTestId("plan-choose-plus").hasAttribute("disabled")).toBe(true);
  });
});

describe("the confirm step", () => {
  it("shows Stripe's lines and puts the amount in the button", async () => {
    render(<PlansScreen />);
    await screen.findByTestId("plan-cards");
    await userEvent.click(screen.getByTestId("plan-choose-plus"));

    await screen.findByTestId("plans-confirm");
    await waitFor(() => expect(screen.getByTestId("confirm-due-today").textContent).toBe("$9"));
    // The amount is in the button because the amount is what is being agreed
    // to — a button reading "Confirm" makes the reader look back up.
    expect(screen.getByTestId("confirm-pay").textContent).toContain("$9");
  });

  it("asks the server for the numbers instead of computing them from the catalogue", async () => {
    const calls = serve();
    render(<PlansScreen />);
    await screen.findByTestId("plan-cards");
    await userEvent.click(screen.getByTestId("plan-choose-premium"));
    await waitFor(() =>
      expect(calls.some((call) => call.includes("/api/billing/change?planId=premium"))).toBe(true),
    );
  });

  // **A stale plan version at pay time is a conflict, not an error** (§29).
  it("re-renders with the new numbers and says so when the plans changed", async () => {
    serve({ change: { error: "stale-version", shown: "plus@v1", live: "plus@v2" }, changeStatus: 409 });
    render(<PlansScreen />);
    await screen.findByTestId("plan-cards");
    await userEvent.click(screen.getByTestId("plan-choose-plus"));
    await screen.findByTestId("confirm-pay");
    await userEvent.click(screen.getByTestId("confirm-pay"));

    const conflict = await screen.findByTestId("plans-version-conflict");
    expect(conflict.textContent).toContain("Nothing has been charged");
  });

  // Moving to free has no money in it: the order card collapses to one button
  // and *What changes* names the losses on the date they happen.
  it("takes no money for the move to free and dates the losses", async () => {
    serve({
      preview: {
        ...PREVIEW,
        kind: "cancel",
        planId: "free",
        planVersionRef: "free@v1",
        lines: [],
        dueTodayMinor: 0,
        effectiveAt: "2026-10-20T00:00:00.000Z",
      },
      plan: {
        ...VIEW,
        catalogue: CATALOGUE.map((c) => ({ ...c, held: c.planId === "premium" })),
      },
    });
    render(<PlansScreen />);
    await screen.findByTestId("plan-cards");
    await userEvent.click(screen.getByTestId("plan-choose-free"));
    await screen.findByTestId("plans-confirm");

    await waitFor(() => expect(screen.getByTestId("confirm-pay").textContent).toBe("Move to free"));
    const changes = screen.getByTestId("confirm-what-changes");
    expect(changes.textContent).toContain("October 20");
    expect(changes.textContent).toContain("Until then nothing changes");
    expect(screen.queryByTestId("confirm-due-today")).toBeNull();
  });
});

describe("coming back from Stripe", () => {
  // **The state §29 says has no design yet.** A redirect proves a browser
  // followed a URL; the grant is the webhook's. So the return lands on pending
  // and the success state is not reachable from a URL.
  it("waits for the webhook rather than announcing success", async () => {
    search.set("checkout", "cs_test_123");
    render(<PlansScreen />);
    const pending = await screen.findByTestId("plans-pending");
    expect(pending.textContent).toContain("Stripe tells us separately");
    expect(screen.queryByTestId("plans-result")).toBeNull();
  });

  // **The defect a browser walk found and this suite did not.** The old test
  // asserted the pending panel was VISIBLE and never read a word of it, so a
  // screen saying *"Your payment has gone through"* — on a typed URL, on a
  // deployment that cannot take payments — passed every run.
  it("never claims a payment happened, because it cannot know that", async () => {
    search.set("checkout", "cs_test_forged_by_hand");
    render(<PlansScreen />);
    const pending = await screen.findByTestId("plans-pending");
    expect(pending.textContent).not.toMatch(/your payment has gone through/i);
    expect(pending.textContent).not.toMatch(/payment (was )?(successful|received)/i);
  });

  // A page titled Plans, showing no plans, with nothing to click — reachable
  // from a bookmark, a back button, or a webhook that never lands.
  it("offers a way back rather than being a dead end", async () => {
    search.set("checkout", "cs_test_123");
    render(<PlansScreen />);
    const back = await screen.findByTestId("plans-pending-back");
    expect(back.getAttribute("href")).toBe("/plans");
  });

  // Shape is not proof of payment, but it does separate "came back from a
  // checkout" from "typed something into the address bar".
  it("ignores a checkout parameter that is not a session id", async () => {
    search.set("checkout", "hello");
    render(<PlansScreen />);
    await screen.findByTestId("plan-cards");
    expect(screen.queryByTestId("plans-pending")).toBeNull();
  });

  // A cancelled checkout is not a pending one — nothing was paid, so there is
  // nothing to wait for and the chooser is where the person still is.
  it("returns to the chooser when the checkout was cancelled", async () => {
    search.set("checkout", "cancelled");
    render(<PlansScreen />);
    await screen.findByTestId("plan-cards");
    expect(screen.queryByTestId("plans-pending")).toBeNull();
  });

  // **A real first purchase: free on arrival, paid once the webhook lands.**
  //
  // The first version of this test served `plus@v1`/`active` from the very
  // first load, which is indistinguishable from an account that was already
  // subscribed — and the fix for the finding above correctly refuses to call
  // that success. Serving the transition is what actually models the flow.
  it("moves to the result once the webhook has moved the account", async () => {
    search.set("checkout", "cs_test_123");
    let served: AccountPlanView = VIEW;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : String(input);
        if (url.startsWith("/api/account/plan")) {
          const body = JSON.stringify({ plan: served });
          // From the second read on, the webhook has landed.
          served = {
            ...VIEW,
            planVersionRef: "plus@v1",
            conferredVersionRef: "plus@v1",
            billing: { ...VIEW.billing, state: "active" },
          };
          return new Response(body, { status: 200 });
        }
        return new Response(JSON.stringify({ preview: PREVIEW }), { status: 200 });
      }),
    );
    render(<PlansScreen />);
    await screen.findByTestId("plans-pending");
    const result = await screen.findByTestId("plans-result", {}, { timeout: 8000 });
    expect(result.textContent).toContain("no need to sign out");
  });

  // **An account that was ALREADY subscribed satisfies "state is active"
  // before its upgrade webhook lands.** Declaring success on that would tell
  // an upgrading customer their new plan was live while they were still on the
  // old one. For an existing subscriber the held version has to move.
  it("keeps waiting when an existing subscriber's plan has not moved yet", async () => {
    search.set("checkout", "cs_test_123");
    const subscribed: AccountPlanView = {
      ...VIEW,
      planVersionRef: "plus@v1",
      conferredVersionRef: "plus@v1",
      billing: { ...VIEW.billing, state: "active" },
    };
    serve({ plan: subscribed });
    render(<PlansScreen />);
    await screen.findByTestId("plans-pending");
    // Long enough for several poll intervals; the page must still be waiting.
    await new Promise((resolve) => setTimeout(resolve, 3200));
    expect(screen.queryByTestId("plans-result")).toBeNull();
    expect(screen.getByTestId("plans-pending")).toBeTruthy();
  });
});
