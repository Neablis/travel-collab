import { describe, expect, it } from "vitest";
import type { Money, TripDetail } from "@tc/contracts";
import { tripDetailFactory } from "@tc/factories";
import { renderMacro } from "../../registry";
import type { Rendered, WidgetContext } from "../../registry-types";
import { personNames } from "./balances";

// "Who owes what" and "What one person is in for" (M19 part 2). The split itself
// is `balances` in `@tc/contracts`, property-tested there; what is tested here
// is what the widgets add — names instead of ids, the rows and the sentence,
// the trip's currency only, the filters, and that the two cannot disagree.

const MEMBERS = ["u-ana", "u-ben", "u-cy"];
const PEOPLE = { "u-ana": "Ana", "u-ben": "Ben", "u-cy": "Cy" };
const usd = (amountMinor: number): Money => ({ amountMinor, currency: "USD" });

/** Two dated days of two stops, nothing priced, three members, in USD. */
function tripOf(): TripDetail {
  const trip = tripDetailFactory.build(
    { members: MEMBERS.map((userId, i) => ({ userId, role: i === 0 ? "owner" : "editor" })) },
    { transient: { dayCount: 2, activitiesPerDay: 2, unscheduledCount: 0 } },
  );
  trip.currency = "USD";
  return trip;
}

/** Price stop `slot` of day `day`, and say who is in it and who booked it. */
function price(trip: TripDetail, day: number, slot: number, cost: Money | null, participants: string[], bookedBy: string | null) {
  const id = trip.days[day]!.activityIds[slot]!;
  trip.activities[id] = { ...trip.activities[id]!, cost, participants, bookedBy };
}

const ctx = (trip: TripDetail | undefined, people: WidgetContext["people"] = PEOPLE): WidgetContext => ({
  trip, page: { tripId: trip?.tripId ?? "t" }, user: null, globals: null, today: null, people,
});

/** The table as plain strings, row by row: lead, then each cell's text. */
function tableOf(trip: TripDetail, params: Record<string, unknown> = {}, people?: WidgetContext["people"]): string[][] {
  const outcome = renderMacro(ctx(trip, people), "cost.balances", params);
  if (outcome.status !== "ok" || outcome.rendered.kind !== "rows") throw new Error(`expected rows, got ${JSON.stringify(outcome)}`);
  return outcome.rendered.rows.map((row) => [row.lead.map((s) => s.text).join(""), ...row.cells.map((c) => c.map((s) => s.text).join(""))]);
}

const said = (rendered: Rendered) => (rendered.kind === "inline" ? rendered.segs.map((s) => s.text).join("") : "");

function sentenceOf(trip: TripDetail, who: string, params: Record<string, unknown> = {}): string {
  const outcome = renderMacro(ctx(trip), "person.share", { who, ...params });
  if (outcome.status !== "ok") throw new Error(`expected a sentence, got ${JSON.stringify(outcome)}`);
  return said(outcome.rendered);
}

describe("cost.balances — Who owes what", () => {
  it("lists every member's share, what they paid and their balance, then what nobody has paid", () => {
    const trip = tripOf();
    // Dinner for all three at $30 a head, booked by Ana: she paid $90.
    price(trip, 0, 0, usd(30_00), [], "u-ana");
    // A $50 ticket for Cy alone, booked by Ben.
    price(trip, 0, 1, usd(50_00), ["u-cy"], "u-ben");
    // A $20 tour for Ana and Ben that nobody has booked.
    price(trip, 1, 0, usd(20_00), ["u-ana", "u-ben"], null);

    expect(tableOf(trip)).toEqual([
      ["Ana", "$50.00", "$90.00", "is owed $40.00"],
      ["Ben", "$50.00", "$50.00", "even"],
      ["Cy", "$80.00", "", "owes $80.00"],
      ["Not paid yet", "$40.00", "", "nobody booked it"],
    ]);
  });

  it("heads its columns, so a reader can tell a share from a payment", () => {
    const trip = tripOf();
    price(trip, 0, 0, usd(10_00), [], "u-ana");
    const outcome = renderMacro(ctx(trip), "cost.balances", {});
    expect(outcome.status === "ok" && outcome.rendered.kind === "rows" ? outcome.rendered.headings : null).toEqual([
      "Who", "Share", "Paid", "Balance",
    ]);
  });

  it("counts only the trip's currency, and names what it left out", () => {
    const trip = tripOf();
    price(trip, 0, 0, usd(10_00), ["u-ana"], "u-ana");
    price(trip, 0, 1, { amountMinor: 5000, currency: "EUR" }, ["u-ben"], "u-cy");
    const table = tableOf(trip);
    // Ben's euro ticket is in nobody's balance…
    expect(table.find((r) => r[0] === "Ben")).toEqual(["Ben", "", "", "even"]);
    // …and is named rather than silently dropped.
    expect(table.at(-1)).toEqual(["Not counted", "€50.00 in other currencies", "", ""]);
  });

  it("is empty with nothing priced, and says so when everything is in another currency", () => {
    const trip = tripOf();
    expect(renderMacro(ctx(trip), "cost.balances", {}).status).toBe("empty");
    price(trip, 0, 0, { amountMinor: 5000, currency: "EUR" }, [], "u-ana");
    expect(renderMacro(ctx(trip), "cost.balances", {})).toEqual({ status: "empty", because: "only priced in other currencies: €50.00" });
  });

  it("narrows to the stops its filters select, as every cost widget does", () => {
    const trip = tripOf();
    price(trip, 0, 0, usd(30_00), [], "u-ana");
    price(trip, 1, 0, usd(20_00), ["u-ben"], "u-ben");
    // Day 2 only: Ana's dinner is not in it.
    expect(tableOf(trip, { day: { kind: "index", index: 1 } })[0]).toEqual(["Ana", "", "", "even"]);
  });

  it("keeps someone who left the trip, so the money still adds up", () => {
    const trip = tripOf();
    price(trip, 0, 0, usd(10_00), ["u-ana", "u-gone"], "u-ana");
    expect(tableOf(trip).find((r) => r[0] === "Former member")).toEqual(["Former member", "$10.00", "", "owes $10.00"]);
  });
});

describe("person.share — What one person is in for", () => {
  it("says one member's share, what they paid and where that leaves them", () => {
    const trip = tripOf();
    price(trip, 0, 0, usd(30_00), [], "u-ana");
    price(trip, 0, 1, usd(50_00), ["u-cy"], "u-ben");
    expect(sentenceOf(trip, "u-ana")).toBe("Ana is in for $30.00 across 1 stop, has paid $90.00 and is owed $60.00");
    expect(sentenceOf(trip, "u-cy")).toBe("Cy is in for $80.00 across 2 stops and owes $80.00");
    expect(sentenceOf(trip, "u-ben")).toBe("Ben is in for $30.00 across 1 stop, has paid $50.00 and is owed $20.00");
  });

  it("says the same as that person's row of Who owes what, for every member", () => {
    // One `balances` call behind both, so they cannot disagree; this pins it.
    const trip = tripOf();
    price(trip, 0, 0, usd(30_00), [], "u-ana");
    price(trip, 0, 1, usd(50_00), ["u-cy"], "u-ben");
    price(trip, 1, 0, usd(20_00), ["u-ana", "u-ben"], null);
    for (const [name, share, , standing] of tableOf(trip).slice(0, MEMBERS.length)) {
      const userId = MEMBERS[Object.values(PEOPLE).indexOf(name!)]!;
      const sentence = sentenceOf(trip, userId);
      expect(sentence, name).toContain(`is in for ${share}`);
      expect(sentence, name).toContain(standing === "even" ? "is even" : standing);
    }
  });

  it("asks who it is about before saying anything", () => {
    const outcome = renderMacro(ctx(tripOf()), "person.share", {});
    expect(outcome).toMatchObject({ status: "unbound", needs: "person" });
  });

  it("is empty for a member in nothing priced, and for an id that is not on the trip", () => {
    const trip = tripOf();
    price(trip, 0, 0, usd(10_00), ["u-ana"], "u-ana");
    expect(renderMacro(ctx(trip), "person.share", { who: "u-cy" })).toEqual({ status: "empty" });
    expect(renderMacro(ctx(trip), "person.share", { who: "u-stranger" })).toEqual({ status: "empty", because: "not on this trip" });
  });
});

describe("personNames", () => {
  it("uses the name it was handed, then the member's place in the trip, never the id", () => {
    const trip = tripOf();
    expect([...personNames(trip, { "u-ben": "Ben" }, MEMBERS).values()]).toEqual(["Traveler 1", "Ben", "Traveler 3"]);
    expect([...personNames(trip, null, ["u-cy"]).values()]).toEqual(["Traveler 3"]);
  });

  it("numbers former members only when there is more than one, so two rows never read as one person", () => {
    const trip = tripOf();
    expect([...personNames(trip, PEOPLE, ["u-x"]).values()]).toEqual(["Former member"]);
    expect([...personNames(trip, PEOPLE, ["u-ana", "u-x", "u-y"]).values()]).toEqual(["Ana", "Former member 1", "Former member 2"]);
  });
});
