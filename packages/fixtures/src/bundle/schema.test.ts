import { describe, expect, it } from "vitest";
import { AddActivity, SavedStop } from "@tc/contracts";
import { parseBundle } from "./schema.ts";
import { bundleActivityCommands, bundleTripCommandGroups, tripIdFor } from "./toCommands.ts";
import { playbookIdFor, resolvePlaybook, toSavedStop } from "./toPlaybooks.ts";
import { instantiateBundleNotebook } from "./toNotebooks.ts";
import { bundleId } from "./ids.ts";

const TODAY = "2026-09-06";
const mintId = () => {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
};

const stop = (over: Record<string, unknown> = {}) => ({
  title: "A stop",
  timeWindow: { start: "09:00", end: "10:00" },
  location: { name: "Somewhere", city: "Lisbon", area: "Alfama" },
  ...over,
});

const bundle = (over: Record<string, unknown> = {}) =>
  parseBundle({
    $schema: "travel-collab/content-bundle/v1",
    bundle: { id: "test", name: "Test", origin: "ai" },
    ...over,
  });

describe("parseBundle", () => {
  it("defaults every section to empty, so a bundle can carry one kind of thing", () => {
    const parsed = bundle();
    expect(parsed).toMatchObject({ trips: [], playbooks: [], notebooks: [], activities: [] });
  });

  // One honest declaration at the top of a generated file covers every day in
  // it — which is why the inheritance is resolved here rather than left to
  // every reader to remember.
  it("hands the bundle's origin down to a playbook that does not override it", () => {
    const parsed = bundle({
      playbooks: [
        { key: "inherits", name: "A", ownerId: "dev-a", sourceTrip: { name: "T" }, stops: [stop()] },
        { key: "overrides", name: "B", ownerId: "dev-b", origin: "human", sourceTrip: { name: "T" }, stops: [stop()] },
      ],
    });
    expect(parsed.playbooks.map((p) => p.origin)).toEqual(["ai", "human"]);
  });

  it("refuses a trip that gives both date forms, or neither", () => {
    const days = [{ label: "One", stops: [stop()] }];
    const trip = (over: Record<string, unknown>) => ({ key: "t", name: "T", days, ...over });
    expect(() => bundle({ trips: [trip({ startsInDays: 3, startDate: "2027-01-01" })] })).toThrow();
    expect(() => bundle({ trips: [trip({})] })).toThrow();
    expect(() => bundle({ trips: [trip({ startsInDays: 3 })] })).not.toThrow();
  });

  // The format composes the contracts' schemas rather than restating them, so
  // a stop it accepts is a stop the command API accepts. These are the two
  // rules a bundle is most likely to get wrong by hand.
  it("refuses a time window that ends before it starts, and a fractional cost", () => {
    const withStops = (s: unknown) => ({
      playbooks: [{ key: "k", name: "N", ownerId: "dev-a", sourceTrip: { name: "T" }, stops: [s] }],
    });
    expect(() => bundle(withStops(stop({ timeWindow: { start: "12:00", end: "09:00" } })))).toThrow();
    expect(() => bundle(withStops(stop({ cost: { amountMinor: 12.5, currency: "USD" } })))).toThrow();
  });
});

describe("bundleId", () => {
  it("is stable, namespaced, and shaped like the uuid every column expects", () => {
    expect(bundleId("playbook:a", "day")).toBe(bundleId("playbook:a", "day"));
    expect(bundleId("playbook:a", "day")).not.toBe(bundleId("playbook:b", "day"));
    expect(bundleId("playbook:a", "day")).not.toBe(bundleId("playbook:a", "other"));
    expect(bundleId("playbook:a", "day")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe("bundleTripCommandGroups", () => {
  const trip = {
    key: "a-trip",
    name: "A trip",
    currency: "USD",
    budget: { amountMinor: 100_000, currency: "USD" },
    startsInDays: 3,
    days: [
      { label: "One", stops: [stop({ title: "First" }), stop({ title: "Second", timeWindow: { start: "11:00", end: "12:00" } })] },
      { label: "Two", stops: [stop({ title: "Third" })] },
    ],
    backlog: [{ title: "Parked" }],
  };

  it("groups as setup, then one group per day, then the backlog", () => {
    const groups = bundleTripCommandGroups("test", bundle({ trips: [trip] }).trips[0]!, { today: TODAY, mintId: mintId() });
    expect(groups.map((g) => g.map((c) => c.type))).toEqual([
      ["SetTripDates", "SetTripBudget"],
      ["AddActivity", "AddActivity"],
      ["AddActivity"],
      ["AddActivity"],
    ]);
  });

  it("resolves startsInDays against the date it is given, never a clock", () => {
    const [setup] = bundleTripCommandGroups("test", bundle({ trips: [trip] }).trips[0]!, { today: TODAY, mintId: mintId() });
    expect(setup![0]).toMatchObject({ type: "SetTripDates", startDate: "2026-09-09", endDate: "2026-09-10" });
  });

  // `SetTripCurrency` is refused as a no-op by the domain when it matches the
  // default, so a USD trip must not send one — a defect this repo has already
  // hit once through `db-seed.ts`.
  it("sends no SetTripCurrency for a USD trip, and one for anything else", () => {
    const usd = bundleTripCommandGroups("test", bundle({ trips: [trip] }).trips[0]!, { today: TODAY, mintId: mintId() });
    expect(usd[0]!.some((c) => c.type === "SetTripCurrency")).toBe(false);
    const eur = bundleTripCommandGroups(
      "test",
      bundle({ trips: [{ ...trip, currency: "EUR", budget: { amountMinor: 1, currency: "EUR" } }] }).trips[0]!,
      { today: TODAY, mintId: mintId() },
    );
    expect(eur[0]!.some((c) => c.type === "SetTripCurrency")).toBe(true);
  });

  // A backlog item is `AddActivity` with no `dayId` — the contract's own
  // documented "omitted = backlog".
  it("puts scheduled stops on their day and the backlog on none, and emits real AddActivity commands", () => {
    const groups = bundleTripCommandGroups("test", bundle({ trips: [trip] }).trips[0]!, { today: TODAY, mintId: mintId() });
    const adds = groups.flat().filter((c) => c.type === "AddActivity");
    for (const command of adds) expect(AddActivity.safeParse(command).success).toBe(true);
    expect(adds.filter((c) => "dayId" in c && c.dayId !== undefined)).toHaveLength(3);
    expect(adds.at(-1)).toMatchObject({ title: "Parked" });
    expect("dayId" in adds.at(-1)!).toBe(false);
  });

  it("addresses the trip the bundle names unless a caller supplies an id", () => {
    const parsed = bundle({ trips: [trip] }).trips[0]!;
    const derived = bundleTripCommandGroups("test", parsed, { today: TODAY, mintId: mintId() });
    expect(derived[0]![0]).toMatchObject({ tripId: tripIdFor("test", "a-trip") });
    const supplied = bundleTripCommandGroups("test", parsed, {
      today: TODAY,
      mintId: mintId(),
      tripId: "11111111-1111-4111-8111-111111111111",
    });
    expect(supplied[0]![0]).toMatchObject({ tripId: "11111111-1111-4111-8111-111111111111" });
  });
});

describe("resolvePlaybook", () => {
  const playbook = {
    key: "a-day",
    name: "A day",
    ownerId: "dev-carlos",
    visibility: "public" as const,
    keptOn: "2026-04-12T09:00:00.000Z",
    sourceTrip: { name: "A trip nobody can open" },
    addedBy: [{ addedBy: "dev-priya" }, { addedBy: "dev-maeve" }],
    stops: [stop({ cost: { amountMinor: 1_000, currency: "USD" } }), { title: "Untimed" }],
  };

  it("mints stable ids for the day, its snapshot source trip, and every ledger row", () => {
    const parsed = bundle({ playbooks: [playbook] });
    const row = resolvePlaybook("test", parsed.playbooks[0]!, "ai");
    expect(row.savedDayId).toBe(playbookIdFor("test", "a-day"));
    expect(row.sourceTripName).toBe("A trip nobody can open");
    // Distinct per add: `saved_day_adds` is keyed on (saved_day_id, trip_id),
    // so two adds sharing a trip id would collapse into one row.
    expect(new Set(row.addedBy.map((a) => a.tripId)).size).toBe(2);
    expect(resolvePlaybook("test", parsed.playbooks[0]!, "ai")).toEqual(row);
  });

  it("derives nothing the server derives — no cities, no adds count", () => {
    const row = resolvePlaybook("test", bundle({ playbooks: [playbook] }).playbooks[0]!, "ai");
    expect(row).not.toHaveProperty("cities");
    expect(row).not.toHaveProperty("adds");
  });

  // A bundle spells "no cost" as an absent field (hand-written, so absence is
  // the cheap default); a stored jsonb value spells it `null`, so a parser can
  // tell it from a field that was never written.
  it("turns absent bundle fields into the explicit nulls a SavedStop carries", () => {
    const row = resolvePlaybook("test", bundle({ playbooks: [playbook] }).playbooks[0]!, "ai");
    for (const s of row.stops) expect(SavedStop.safeParse(s).success).toBe(true);
    expect(row.stops[1]).toEqual({
      title: "Untimed",
      timeWindow: null,
      location: null,
      notes: null,
      anchors: [],
      kind: "planned",
      tags: [],
      cost: null,
    });
    expect(toSavedStop({ title: "Bare" }).kind).toBe("planned");
  });

  it("takes the bundle's authorKind when the playbook does not name one", () => {
    const parsed = bundle({ playbooks: [playbook, { ...playbook, key: "human-day", origin: "human" as const }] });
    expect(parsed.playbooks.map((p) => resolvePlaybook("test", p, parsed.bundle.origin).authorKind)).toEqual([
      "ai",
      "human",
    ]);
  });
});

describe("loose activities and notebooks", () => {
  it("turns loose activities into backlog AddActivity commands", () => {
    const parsed = bundle({ activities: [{ title: "Etxebarri", kind: "idea" }, stop({ title: "Maybe" })] });
    const commands = bundleActivityCommands("11111111-1111-4111-8111-111111111111", parsed.activities, mintId());
    expect(commands).toHaveLength(2);
    for (const command of commands) {
      expect(AddActivity.safeParse(command).success).toBe(true);
      expect("dayId" in command).toBe(false);
    }
    expect(commands[0]).toMatchObject({ title: "Etxebarri", kind: "idea" });
  });

  // A template is trip-agnostic and a page is not, so instantiating is exactly
  // "say which trip".
  it("binds a notebook template to one trip and changes nothing else", () => {
    const notebook = {
      key: "n",
      title: "A notebook",
      description: "One line",
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }] },
    };
    const parsed = bundle({ notebooks: [notebook] });
    const tripId = "11111111-1111-4111-8111-111111111111";
    const input = instantiateBundleNotebook(parsed.notebooks[0]!, tripId);
    expect(input).toEqual({ title: "A notebook", context: { tripId }, content: parsed.notebooks[0]!.content });
    expect(parsed.notebooks[0]!.seedIntoNewTrips).toBe(false);
  });
});
