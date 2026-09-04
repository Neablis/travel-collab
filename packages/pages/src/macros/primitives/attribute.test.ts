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

  it("accepts every field on the list, and only those four", () => {
    // Non-vacuous from both sides: each declared field parses, and the list is
    // exactly the four the spec's §3 table names. A fifth added without a
    // reader below would pass the loop and fail the count.
    expect(AttributeFieldRef.options).toEqual([
      "trip.name",
      "trip.budgetRemaining",
      "account.name",
      "account.homeAirport",
    ]);
    for (const field of AttributeFieldRef.options) {
      expect(insertWidget("attribute", { field }).ok, `${field} was refused`).toBe(true);
    }
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
    const noTrip: WidgetContext = { page: { tripId: trip.tripId }, user: ctx.user, globals: null };
    expect(renderMacro(noTrip, "attribute", { field: "trip.name" })).toEqual({ status: "unbound", needs: "trip" });
    expect(renderMacro(noTrip, "attribute", { field: "account.name" })).toEqual({
      status: "ok",
      rendered: { kind: "inline", segs: [{ kind: "chip", name: "value", text: "Priya" }] },
    });
  });
});
