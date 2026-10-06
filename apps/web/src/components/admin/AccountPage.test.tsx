import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminAccountDetail, AdminAccountGrantRecord } from "@/lib/adminAccount";
import type { AdminAccountRow } from "@/lib/adminOverview";

// **The account page** (M36 link 3): its sections for one account, the
// questions-a-day ceiling rule both ways, both empty states, and Revoke's
// confirm and failure line. The read behind it is `accountDetail.int.test.ts`.

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import { AccountPage } from "./AccountPage";

const NOW = "2026-10-06T12:00:00.000Z";
const DAY = 24 * 60 * 60 * 1000;
const daysBefore = (days: number) => new Date(Date.parse(NOW) - days * DAY).toISOString();

const GRANT: AdminAccountGrantRecord = {
  id: "grant-1",
  source: "trial",
  planVersionRef: "plus@v2",
  grantedBy: null,
  createdAt: daysBefore(3),
  expiresAt: daysBefore(-4),
  revokedAt: null,
  revokedBy: null,
  active: true,
};

const ROW: AdminAccountRow = {
  userId: "dev-mei",
  email: "mei@example.test",
  planVersionRef: "free@v1",
  isAdmin: false,
  grantSources: ["trial"],
  grants: [{ id: "grant-1", source: "trial", planVersionRef: "plus@v2", expiresAt: GRANT.expiresAt }],
  entitlements: ["ai.ask", "ai.command"],
  requests: 42,
  microUsd: 120_000,
  unpriced: 0,
  paysMicroUsd: 0,
  subscriptionState: null,
  lastActiveAt: daysBefore(0.5),
};

/** Thirty days at `daily` questions, with `peak` on the last one. */
const days = (daily: number, peak = daily) => [...Array.from({ length: 29 }, () => daily), peak];

function detail(over: { assistant?: Partial<AdminAccountDetail["assistant"]>; grants?: AdminAccountGrantRecord[] } = {}): AdminAccountDetail {
  return {
    windowDays: 30,
    plan: {
      account: ROW,
      state: "granted",
      underwater: false,
      joinedAt: daysBefore(40),
      grants: over.grants ?? [GRANT],
      history: [
        { at: GRANT.createdAt, what: "Granted plus v2 — trial" },
        { at: daysBefore(40), what: "Signed up" },
      ],
      fallsBackTo: "free@v1",
      offersAssistant: true,
      requestsPerDay: 100,
    },
    assistant: {
      offered: true,
      requestsPerDay: 100,
      questions: 42,
      steps: 97,
      medianToolCalls: 3,
      contextMedian: 5200,
      contextP95: 31_000,
      failed: 1,
      perDay: days(1, 2),
      topTools: [
        { tool: "read_trip", calls: 38 },
        { tool: "AddActivity", calls: 12 },
      ],
      recent: [
        {
          at: daysBefore(0.2),
          kind: "change",
          model: "zai/glm-5.3",
          steps: 5,
          toolCalls: 6,
          peakContext: 26_000,
          latencyMs: 9100,
          outcome: "failed",
        },
      ],
      ...over.assistant,
    },
    activeDays: 12,
    trips: { owned: 2, invitedTo: 1 },
    notebooks: 3,
    activity: {
      editsPerDay: days(0, 4),
      recent: [{ at: daysBefore(0.1), what: "Moved a stop in Japan" }],
    },
  };
}

const page = (value: AdminAccountDetail = detail()) => (
  <AccountPage detail={value} plans={["plus", "premium"]} back="/admin?tab=users&filter=granted" now={NOW} />
);

const assistantPanel = () => screen.getByRole("complementary", { name: "Assistant · last 30 days" });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  refresh.mockReset();
  vi.unstubAllGlobals();
});

describe("AccountPage", () => {
  it("draws the account's header, facts, assistant, activity and grants", () => {
    render(page());
    expect(screen.getByRole("link", { name: "← All accounts" }).getAttribute("href")).toBe(
      "/admin?tab=users&filter=granted",
    );
    expect(screen.getByText("mei@example.test")).toBeTruthy();
    expect(screen.getByText("free v1")).toBeTruthy();
    expect(screen.getByText("granted")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Grant a plan to dev-mei" })).toBeTruthy();

    const facts = screen.getByLabelText("Facts");
    expect(within(facts).getByText("2 own · 1 invited to")).toBeTruthy();
    expect(within(facts).getByText("active 12 of 30 days")).toBeTruthy();
    expect(within(facts).getByText("comped")).toBeTruthy();

    const assistant = assistantPanel();
    expect(within(assistant).getByText("5.2k · 31k")).toBeTruthy();
    expect(within(assistant).getByText("read_trip")).toBeTruthy();
    const turn = within(within(assistant).getByRole("table", { name: "Recent turns" })).getAllByRole("row")[1]!;
    expect(within(turn).getByText("26k")).toBeTruthy();
    expect(within(turn).getByText("9.1s")).toBeTruthy();
    expect(within(turn).getByText("failed")).toBeTruthy();
    expect(
      within(assistant).getByText(
        "The ledger keeps counts and sizes, never the question or the trip — so this shows what a turn cost, not what was asked.",
      ),
    ).toBeTruthy();

    expect(screen.getByText("Moved a stop in Japan")).toBeTruthy();
    expect(screen.getByText("trial grant · plus v2")).toBeTruthy();
    expect(screen.getByText("Signed up")).toBeTruthy();
  });

  // D7: the page grows no "view question" affordance. The assistant panel
  // reports; nothing in it opens, links or expands.
  it("offers nothing to click in the assistant section", () => {
    render(page());
    const assistant = assistantPanel();
    expect(within(assistant).queryAllByRole("button")).toEqual([]);
    expect(within(assistant).queryAllByRole("link")).toEqual([]);
  });

  describe("questions a day against the ceiling", () => {
    const chart = () => screen.getByTestId("questions-a-day");

    it("draws the ceiling when the peak is over 40% of it, and counts the days at it", () => {
      render(page(detail({ assistant: { perDay: [...days(10, 100).slice(0, 28), 100, 100] } })));
      expect(within(chart()).getByTestId("ceiling-line")).toBeTruthy();
      expect(within(chart()).getByText("dashed line = 100 a day ceiling · hit on 2 days")).toBeTruthy();
    });

    // The threshold itself: 41 of 100 is over 40%, and draws; 40 (below) does not.
    it("draws it from just over 40%, with no day at the ceiling", () => {
      render(page(detail({ assistant: { perDay: days(5, 41) } })));
      expect(within(chart()).getByTestId("ceiling-line")).toBeTruthy();
      expect(within(chart()).getByText("dashed line = 100 a day ceiling · hit on 0 days")).toBeTruthy();
    });

    it("leaves the ceiling out when the peak is well under it", () => {
      render(page(detail({ assistant: { perDay: days(5, 40) } })));
      expect(within(chart()).queryByTestId("ceiling-line")).toBeNull();
      expect(within(chart()).getByText("ceiling 100 a day — well above this")).toBeTruthy();
    });

    it("says so plainly when no version names a ceiling", () => {
      render(page(detail({ assistant: { requestsPerDay: null, perDay: days(5, 400) } })));
      expect(within(chart()).queryByTestId("ceiling-line")).toBeNull();
      expect(within(chart()).getByText("no daily ceiling of its own — the deployment default applies")).toBeTruthy();
    });
  });

  describe("the assistant's empty states", () => {
    it("says a plan without ai.* has no assistant", () => {
      render(page(detail({ assistant: { offered: false, questions: 0, recent: [], topTools: [] } })));
      expect(within(assistantPanel()).getByText("No assistant on this plan")).toBeTruthy();
      expect(screen.queryByTestId("questions-a-day")).toBeNull();
    });

    it("says an account with the assistant has not asked", () => {
      render(page(detail({ assistant: { questions: 0, recent: [], topTools: [] } })));
      expect(within(assistantPanel()).getByText("Hasn’t asked anything in 30 days")).toBeTruthy();
    });
  });

  describe("Revoke", () => {
    const card = () => screen.getByTestId("grant-grant-1");

    it("asks first, in the spec's words, and Keep it changes nothing", async () => {
      const user = userEvent.setup();
      render(page());
      await user.click(within(card()).getByRole("button", { name: "Revoke the trial grant of plus v2" }));
      expect(
        within(card()).getByText(
          "They drop to free v1 on their next request. The grant row stays, marked revoked.",
        ),
      ).toBeTruthy();
      await user.click(within(card()).getByRole("button", { name: "Keep it" }));
      expect(fetchMock).not.toHaveBeenCalled();
      expect(within(card()).queryByText(/marked revoked/)).toBeNull();
    });

    it("says nothing changed when the server refuses, and keeps the card", async () => {
      const user = userEvent.setup();
      fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "not-found" }), { status: 404 }));
      render(page());
      await user.click(within(card()).getByRole("button", { name: "Revoke the trial grant of plus v2" }));
      await user.click(within(card()).getByRole("button", { name: "Revoke" }));

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/grants",
        expect.objectContaining({ method: "DELETE", body: JSON.stringify({ grantId: "grant-1" }) }),
      );
      expect(
        (await within(card()).findByRole("alert")).textContent,
      ).toBe("The revoke didn't reach the server. Nothing changed — they still hold it.");
      expect(screen.getByText("trial grant · plus v2")).toBeTruthy();
      expect(refresh).not.toHaveBeenCalled();
    });

    it("takes the card away and re-reads the page when it lands", async () => {
      const user = userEvent.setup();
      fetchMock.mockResolvedValue(new Response(JSON.stringify({ revoked: true }), { status: 200 }));
      render(page());
      await user.click(within(card()).getByRole("button", { name: "Revoke the trial grant of plus v2" }));
      await user.click(within(card()).getByRole("button", { name: "Revoke" }));
      expect(await screen.findByText("Revoked — mei@example.test holds free v1 from their next request")).toBeTruthy();
      expect(screen.queryByTestId("grant-grant-1")).toBeNull();
      expect(refresh).toHaveBeenCalledTimes(1);
    });
  });
});
