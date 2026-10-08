import { describe, expect, it } from "vitest";
import type { TripDetail } from "@tc/contracts";
import { tripDetailFactory } from "@tc/factories";
import { renderMacro } from "../../registry";
import type { TripPeoplePayload, WidgetContext, WidgetPersona } from "../../registry-types";

// "Who's going" (M38). What a reader cannot check from the chips alone is WHO
// the sentence leaves out and whose word it takes for who is travelling, so
// those are what is pinned: personas over `trip.members` (the invite preview's
// whole reason for the widget), the owner named last, planners omitted.

const persona = (name: string, travelling = true, extra: Partial<WidgetPersona> = {}): WidgetPersona => ({
  name, avatar: null, color: null, travelling, ...extra,
});

/** A trip whose members are `ids`, the first one owning it. */
function tripOf(ids: readonly string[], travelling?: boolean): TripDetail {
  return tripDetailFactory.build(
    { members: ids.map((userId, i) => ({ userId, role: i === 0 ? "owner" : "editor", ...(travelling === undefined ? {} : { travelling }) })) },
    { transient: { dayCount: 1, activitiesPerDay: 0, unscheduledCount: 0 } },
  );
}

const ctx = (trip: TripDetail | undefined, personas?: WidgetContext["personas"], people?: WidgetContext["people"]): WidgetContext => ({
  trip, page: { tripId: trip?.tripId ?? "t" }, user: null, globals: null, today: null, personas, people,
});

function peopleOf(context: WidgetContext): TripPeoplePayload {
  const outcome = renderMacro(context, "trip.people", {});
  if (outcome.status !== "ok" || outcome.rendered.kind !== "block" || outcome.rendered.block.kind !== "trip-people") {
    throw new Error(`expected a trip-people block, got ${JSON.stringify(outcome)}`);
  }
  return outcome.rendered.block;
}

describe("trip.people", () => {
  it("reads who is going from the personas, not trip.members — the invite preview marks every member not travelling", () => {
    const out = peopleOf(
      ctx(tripOf(["p0", "p1", "p2"], false), {
        p0: persona("Dana Reyes"),
        p1: persona("Sam Okafor", true, { avatar: "mountain", color: "plum" }),
        p2: persona("Priya", true, { color: "ochre" }),
      }),
    );
    expect(out.sentence).toBe("Sam and Priya are going with Dana.");
    // The chips are the sentence's subjects, as each chose to look.
    expect(out.stack).toEqual([
      { name: "Sam Okafor", avatar: "mountain", color: "plum" },
      { name: "Priya", avatar: null, color: "ochre" },
    ]);
  });

  it("stacks four and counts the rest, as the landing's crew line did", () => {
    const ids = ["o", "a", "b", "c", "d", "e"];
    const names = ["Dana", "Sam", "Priya", "Kenji", "Mei", "Tom"];
    const out = peopleOf(ctx(tripOf(ids), Object.fromEntries(ids.map((id, i) => [id, persona(names[i]!)]))));
    expect(out.sentence).toBe("Sam, Priya, Kenji and 2 others are going with Dana.");
    expect(out.stack.map((p) => p.name)).toEqual(["Sam", "Priya", "Kenji", "Mei"]);
  });

  it("leaves out whoever is only helping plan, the owner included", () => {
    const out = peopleOf(
      ctx(tripOf(["o", "a", "b", "c"]), { o: persona("Dana", false), a: persona("Sam"), b: persona("Priya", false), c: persona("Mei") }),
    );
    expect(out.sentence).toBe("Sam and Mei are going.");
    expect(out.stack.map((p) => p.name)).toEqual(["Sam", "Mei"]);
  });

  it("says the owner alone is going, and stacks them", () => {
    const out = peopleOf(ctx(tripOf(["o", "a"]), { o: persona("Dana Reyes"), a: persona("Sam", false) }));
    expect(out.sentence).toBe("Dana is going.");
    expect(out.stack.map((p) => p.name)).toEqual(["Dana Reyes"]);
  });

  // Two Sams read as one person in a sentence. A shared first word takes the
  // last initial, and where that still clashes (or there is no last name) the
  // whole name; everyone else keeps the short form.
  it("tells apart people who share a first name", () => {
    const out = peopleOf(
      ctx(tripOf(["o", "a", "b", "c", "d"]), {
        o: persona("Sam Reyes"),
        a: persona("Sam Okafor"),
        b: persona("Sam"),
        c: persona("Priya Shah"),
        d: persona("Sam Orr"),
      }),
    );
    expect(out.sentence).toBe("Sam Okafor, Sam, Priya and Sam Orr are going with Sam R.");
  });

  it("is empty when nobody is going", () => {
    expect(renderMacro(ctx(tripOf(["o"]), { o: persona("Dana", false) }), "trip.people", {}).status).toBe("empty");
  });

  // The server, the assistant and every older test build a context with no
  // personas; the widget still answers, from the rules every person widget uses.
  it("without personas, names by `personNames` and counts travellers from trip.members", () => {
    const trip = tripOf(["o", "a", "b"]);
    trip.members = trip.members.map((m) => (m.userId === "b" ? { ...m, travelling: false } : m));
    const out = peopleOf(ctx(trip, null, { o: "Dana Reyes" }));
    expect(out.sentence).toBe("Traveler 2 is going with Dana.");
    expect(out.stack).toEqual([{ name: "Traveler 2", avatar: null, color: null }]);
  });

  it("needs a trip", () => {
    expect(renderMacro(ctx(undefined), "trip.people", {}).status).toBe("unbound");
  });
});
