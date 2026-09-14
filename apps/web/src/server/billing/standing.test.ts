import { describe, expect, it } from "vitest";
import { GRACE_WINDOW_DAYS, graceEndsAt, standingOf } from "./standing";
import type { SubscriptionRow } from "./subscriptions";

// **M21 link 6's gate box, to the millisecond**: *"a card fixed on day 2 lapses
// nothing and caps no collaborator, and a card never fixed lapses on day 4 and
// not on day 3."*
//
// `standingOf` is pure over its inputs — no clock read, no I/O — which is what
// makes the boundary testable at all. The alternative shape, a lapse WRITTEN by
// a scheduled job three days after an event nobody is watching, would be
// testable only by waiting or by mocking a scheduler.

const DAY = 24 * 60 * 60 * 1000;
const DECLINED = new Date("2026-10-01T09:00:00.000Z");

function row(over: Partial<SubscriptionRow> = {}): SubscriptionRow {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    userId: "dev-alice",
    stripeCustomerId: "cus_1",
    stripeSubscriptionId: "sub_1",
    planId: "plus",
    planVersion: 1,
    status: "active",
    currentPeriodEnd: new Date("2026-10-20T00:00:00.000Z"),
    cancelAtPeriodEnd: false,
    pastDueSince: null,
    lastEventAt: DECLINED,
    createdAt: DECLINED,
    updatedAt: DECLINED,
    ...over,
  };
}

describe("the grace window has one definition", () => {
  it("is three days, and it is a constant rather than a literal", () => {
    // Mitchell, 2026-09-13. The number is a guess that first contact with real
    // declines will want to revise, which is the whole reason it is one
    // constant read by the resolver, the copy and this test.
    expect(GRACE_WINDOW_DAYS).toBe(3);
    expect(graceEndsAt(DECLINED).getTime() - DECLINED.getTime()).toBe(GRACE_WINDOW_DAYS * DAY);
  });

  // **Measured from the decline, not from the period end** — the two are weeks
  // apart, and the window being anchored to the wrong one is the single most
  // likely way to build this wrong.
  it("is measured from the decline and not from the period end", () => {
    const declined = row({
      status: "past_due",
      pastDueSince: DECLINED,
      currentPeriodEnd: new Date("2026-12-25T00:00:00.000Z"),
    });
    expect(standingOf(declined, new Date(DECLINED.getTime() + 4 * DAY)).lapsed).toBe(true);
  });
});

describe("a declined card", () => {
  const declined = row({ status: "past_due", pastDueSince: DECLINED });

  it("keeps its entitlements on day 2", () => {
    const standing = standingOf(declined, new Date(DECLINED.getTime() + 2 * DAY));
    expect(standing.conferring).toBe(true);
    expect(standing.lapsed).toBe(false);
    expect(standing.graceEndsAt).toEqual(new Date(DECLINED.getTime() + 3 * DAY));
  });

  // The gate box's exact pair. The instant the window ends is the last instant
  // inside it, which is why the comparison is `>` and not `>=`.
  it("has not lapsed on day 3, and has on day 4", () => {
    expect(standingOf(declined, new Date(DECLINED.getTime() + 3 * DAY)).lapsed).toBe(false);
    expect(standingOf(declined, new Date(DECLINED.getTime() + 3 * DAY + 1)).lapsed).toBe(true);
    expect(standingOf(declined, new Date(DECLINED.getTime() + 4 * DAY)).conferring).toBe(false);
  });

  // **A card fixed inside the window costs the account nothing**, and the
  // reason it costs nothing is that nothing was taken away: there was no lapse
  // to undo, only a status that went back to `active`.
  it("costs the account nothing once the payment succeeds", () => {
    const fixed = row({ status: "active", pastDueSince: null });
    const standing = standingOf(fixed, new Date(DECLINED.getTime() + 10 * DAY));
    expect(standing.conferring).toBe(true);
    expect(standing.pastDueSince).toBeNull();
    expect(standing.graceEndsAt).toBeNull();
  });

  // Should not happen — the webhook writes both on the same event — and the
  // forgiving reading is the deliberate one: the alternative treats a missing
  // date as "lapsed since the beginning of time" and cuts off a paying account
  // over a bookkeeping gap.
  it("is forgiven when the decline date is missing, rather than lapsed forever", () => {
    const noDate = row({ status: "past_due", pastDueSince: null });
    expect(standingOf(noDate, new Date(DECLINED.getTime() + 400 * DAY)).conferring).toBe(true);
  });
});

describe("what a status alone decides", () => {
  it.each([
    ["active", true],
    ["trialing", true],
    ["past_due", true],
    ["canceled", false],
    ["unpaid", false],
    ["incomplete", false],
    ["incomplete_expired", false],
    ["paused", false],
  ] as const)("%s confers: %s", (status, confers) => {
    // `past_due` confers because the window, not the status, is what ends it.
    // `unpaid` does not: Stripe reaches it only after giving up entirely, which
    // is weeks after our own window closed.
    expect(standingOf(row({ status, pastDueSince: DECLINED }), DECLINED).conferring).toBe(confers);
  });

  // A cancellation that has not reached its period end is still paid for.
  // M21 link 5: access runs to the end of the paid period and then lapses
  // through M20's resolver — there is no second downgrade path.
  it("keeps conferring while a cancellation runs out its paid period", () => {
    const cancelling = row({ status: "active", cancelAtPeriodEnd: true });
    expect(standingOf(cancelling, DECLINED).conferring).toBe(true);
  });
});
