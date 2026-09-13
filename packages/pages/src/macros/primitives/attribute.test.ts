import { describe, expect, it } from "vitest";
import { AttributeFieldRef } from "@tc/contracts";
import { tripDetailFactory } from "@tc/factories";
import { insertWidget } from "../../insert";
import { renderMacro } from "../../registry";
import type { WidgetContext } from "../../registry-types";
import { formatMoney } from "../../format";

// `attribute` — one primitive over an allow-listed field (ADR-039 decision 6).
// Four widgets that each read one field became one widget told which to read.

const trip = tripDetailFactory.build(
  {},
  { transient: { dayCount: 1, activitiesPerDay: 1, costed: true, budget: { amountMinor: 500_00, currency: "USD" } } },
);
const ctx: WidgetContext = {
  trip,
  page: { tripId: trip.tripId },
  user: { displayName: "Priya", homeAirport: "SFO", distanceUnit: "km" },
  globals: null,
  // A fixed date, because a countdown asserted against the day the suite runs
  // is a test that changes its own answer overnight. Every `trip.countdown`
  // case below moves THIS rather than the trip.
  today: null,
};
const textOf = (params: Record<string, unknown>) => {
  const outcome = renderMacro(ctx, "attribute", params);
  if (outcome.status !== "ok" || outcome.rendered.kind !== "inline") throw new Error(`not ok: ${outcome.status}`);
  return outcome.rendered.segs.map((s) => s.text).join("");
};

describe("attribute's allow-list is closed (ADR-039 decision 6)", () => {
  it("refuses a field that is not on the list, at insert", () => {
    // **The whole point of the allow-list**, and the thing that stops
    // `attribute` becoming a field browser over internal state. `insertWidget`
    // is the one door into a document, so refusing here is refusing everywhere
    // — the picker, the drag, the slash menu and the assistant all go through
    // it (ADR-037 decision 4).
    const invented = insertWidget("attribute", { field: "trip.dismissedConflictIds" });
    expect(invented.ok).toBe(false);
    expect(!invented.ok && invented.error.reason).toBe("bad-params");
    expect(insertWidget("attribute", { field: "user.email" }).ok, "an email is the one to never print").toBe(false);
  });

  it("accepts every field on the list, and only those five", () => {
    // Non-vacuous from both sides: each declared field parses, and the list is
    // exactly the ones the spec's §3 table names plus `trip.countdown`. A sixth
    // added without a reader below would pass the loop and fail this literal.
    expect(AttributeFieldRef.options).toEqual([
      "trip.name",
      "trip.budgetRemaining",
      "trip.countdown",
      "account.name",
      "account.homeAirport",
    ]);
    for (const field of AttributeFieldRef.options) {
      expect(insertWidget("attribute", { field }).ok, `${field} was refused`).toBe(true);
    }
  });

  // `trip.countdown` — the one field that reads the trip against the calendar.
  // `formatCountdown`'s own branches are pinned in `format.test.ts`; these are
  // about the WIDGET: which dates it takes from the trip, and what it says when
  // it cannot answer.
  describe("trip.countdown", () => {
    // Two dated days, deliberately out of order in the array, because the rule
    // this widget inherits from `dates` is that the extremes come from the
    // DATED days rather than from the ends of the list.
    const dated = tripDetailFactory.build({}, { transient: { dayCount: 3 } });
    const tripOn = (dates: (string | null)[]) => ({
      ...dated,
      days: dated.days.map((day, i) => ({ ...day, date: dates[i] ?? null })),
    });

    it("counts down from today to the trip's first dated day", () => {
      const trip = tripOn(["2026-08-01", "2026-08-02", "2026-08-03"]);
      const ctxOn = (today: string): WidgetContext => ({ ...ctx, trip, today });
      const read = (today: string) => {
        const outcome = renderMacro(ctxOn(today), "attribute", { field: "trip.countdown" });
        if (outcome.status !== "ok" || outcome.rendered.kind !== "inline") throw new Error(outcome.status);
        return outcome.rendered.segs.map((seg) => seg.text).join("");
      };
      expect(read("2026-07-22")).toBe("in 10 days");
      expect(read("2026-08-02")).toBe("day 2 of 3");
      expect(read("2026-08-04")).toBe("ended yesterday");
    });

    it("takes the extremes from the dated days, not the ends of the list", () => {
      // A trip dated at the back and open-ended at the front. Reading
      // `days[0].date` would be `null` and the countdown would say nothing at
      // all; reading the extremes of what IS dated answers correctly.
      const trip = tripOn([null, "2026-08-05", null]);
      const outcome = renderMacro({ ...ctx, trip, today: "2026-08-01" }, "attribute", {
        field: "trip.countdown",
      });
      expect(outcome.status).toBe("ok");
      expect(JSON.stringify(outcome)).toContain("in 4 days");
    });

    it("says the dates are not set yet, in its own words rather than the widget's shrug", () => {
      // The state a BRAND-NEW trip is in, and the reason `MacroResult.because`
      // exists: `attribute`'s own `emptyText` is "nothing to show", which is
      // the same sentence for a missing name, a missing budget and a missing
      // home airport. On the first line of a new trip's Overview that says
      // nothing about what to do next.
      const undatedTrip = tripOn([null, null, null]);
      const outcome = renderMacro({ ...ctx, trip: undatedTrip, today: "2026-08-01" }, "attribute", {
        field: "trip.countdown",
      });
      expect(outcome).toEqual({ status: "empty", because: "no dates set yet" });
    });

    it("refuses to guess when it does not know what day it is", () => {
      // `today: null` is the honest state of a widget resolved outside a
      // reader's browser — `resolveMacro`, the AI path, a server check. A
      // countdown against a date it does not have would be a number on a page
      // that is simply wrong.
      const trip = tripOn(["2026-08-01", "2026-08-02", "2026-08-03"]);
      expect(renderMacro({ ...ctx, trip, today: null }, "attribute", { field: "trip.countdown" }).status).toBe(
        "empty",
      );
    });

    it("needs a trip, like every other trip-reading field", () => {
      const outcome = renderMacro(
        { page: { tripId: trip.tripId }, user: ctx.user, globals: null, today: "2026-08-01" },
        "attribute",
        { field: "trip.countdown" },
      );
      expect(outcome).toEqual({ status: "unbound", needs: "trip" });
    });
  });

  it("reads the field it was told to read, and no other", () => {
    // A resolver that ignored `field` and always returned the trip's name would
    // pass any single-field assertion, so all four are checked against values
    // that cannot be confused with one another.
    expect(textOf({ field: "trip.name" })).toBe(trip.name);
    expect(textOf({ field: "account.name" })).toBe("Priya");
    expect(textOf({ field: "account.homeAirport" })).toBe("SFO");
    expect(textOf({ field: "trip.budgetRemaining" })).toBe(formatMoney(trip.budgetRemaining!, "USD"));
  });

  it("says it has nothing to show rather than guessing, in every absent case", () => {
    // ADR-037 decision 6's "not set up", four ways. `account.name` is the one
    // that matters most: the app HAS a fallback chain (`lib/displayName.ts`)
    // which ends at the email address, and a notebook page is a shared
    // document — printing one into a page a collaborator can read is the
    // failure this refuses to have.
    const noUser: WidgetContext = { ...ctx, user: null };
    expect(renderMacro(noUser, "attribute", { field: "account.name" }).status).toBe("empty");
    expect(renderMacro(noUser, "attribute", { field: "account.homeAirport" }).status).toBe("empty");
    const blank: WidgetContext = { ...ctx, user: { displayName: null, homeAirport: "SFO", distanceUnit: "km" } };
    expect(renderMacro(blank, "attribute", { field: "account.name" }).status).toBe("empty");
    // And it did not reach for the sibling field that IS set.
    expect(JSON.stringify(renderMacro(blank, "attribute", { field: "account.name" }))).not.toContain("SFO");

    // **Present but blank, which is a different branch from absent.** `read()`
    // tests `code === ""` and `trip.name.trim() === ""` separately from the
    // null checks above, and neither was reached: a regression that rendered an
    // empty chip's worth of nothing as a VALUE — a tinted, underlined empty
    // pill sitting in a sentence — passed this test while it claimed "every
    // absent case" (CodeRabbit, PR 141).
    const noAirport: WidgetContext = { ...ctx, user: { displayName: "Priya", homeAirport: "", distanceUnit: "km" } };
    expect(renderMacro(noAirport, "attribute", { field: "account.homeAirport" }).status).toBe("empty");
    const unnamed = tripDetailFactory.build({ name: "   " }, { transient: { dayCount: 1 } });
    expect(renderMacro({ ...ctx, trip: unnamed }, "attribute", { field: "trip.name" }).status).toBe("empty");

    const noBudget = tripDetailFactory.build({}, { transient: { dayCount: 1 } });
    expect(
      renderMacro({ ...ctx, trip: noBudget }, "attribute", { field: "trip.budgetRemaining" }).status,
    ).toBe("empty");
  });

  it("shows a negative balance rather than clamping it at zero", () => {
    // Over budget is the state a person most wants a notebook to say out loud,
    // so clamping would suppress the only reading that changes a decision.
    const overspent = tripDetailFactory.build(
      {},
      {
        transient: {
          dayCount: 1,
          activitiesPerDay: 2,
          costed: true,
          budget: { amountMinor: 1, currency: "USD" },
        },
      },
    );
    expect(overspent.budgetRemaining).toBeLessThan(0);
    const outcome = renderMacro({ ...ctx, trip: overspent }, "attribute", { field: "trip.budgetRemaining" });
    expect(outcome.status).toBe("ok");
    expect(JSON.stringify(outcome)).toContain("-");
  });

  it("is empty with no field chosen, rather than reporting itself unbound", () => {
    // `UnboundNeeds` has one member per INPUT type that can be waiting for a
    // choice, and `field` is not an input — it is chosen once, by the preset,
    // and no control could fill it in afterwards. "Not set up" is what this is.
    expect(renderMacro(ctx, "attribute", {}).status).toBe("empty");
  });

  it("needs a trip for a trip field, and no trip at all for an account one", () => {
    // Account scope is always in scope; the trip is a property of the notebook
    // (ADR-037 open question 2). So the same widget answers differently
    // depending on which field it reads, and that is the honest answer rather
    // than a uniform one.
    const noTrip: WidgetContext = { page: { tripId: trip.tripId }, user: ctx.user, globals: null, today: null };
    expect(renderMacro(noTrip, "attribute", { field: "trip.name" })).toEqual({ status: "unbound", needs: "trip" });
    expect(renderMacro(noTrip, "attribute", { field: "account.name" })).toEqual({
      status: "ok",
      rendered: { kind: "inline", segs: [{ kind: "chip", name: "value", text: "Priya" }] },
    });
  });
});
