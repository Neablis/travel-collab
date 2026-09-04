import { describe, expect, it } from "vitest";
import type { FilterDimension as FilterDimensionType, TripDetail } from "@tc/contracts";
import { FilterDimension } from "@tc/contracts";
import { MACRO_REGISTRY, getMacro, resolveMacro, renderMacro, MACRO_NAMES, PRIMITIVE_NAMES, macroCatalog } from "./registry";
import { LEGAL_FILTERS } from "./filters";
import { insertWidget } from "./insert";
import type { WidgetInput } from "./registry-types";

const detail = { tripId: "11111111-1111-1111-1111-111111111111", name: "T", startDate: null, currency: "USD", budget: null, status: "active", members: [{ userId: "u1", role: "owner" }], forkedFrom: null, days: [], backlog: [], activities: {}, conflicts: [], dismissedConflictIds: [], createdAt: "2026-07-20T00:00:00.000Z", unscheduledCostSubtotal: 0, tripCostTotal: 0, budgetRemaining: null } as TripDetail;

describe("registry", () => {
  it("registers all seven starter macros keyed by name", () => {
    expect(MACRO_NAMES).toEqual(expect.arrayContaining(["trip.name","trip.dates","cost.trip","cost.day","itinerary.day","itinerary.trip","costs.table"]));
    for (const name of MACRO_NAMES) expect(getMacro(name)!.name).toBe(name);
  });
  it("resolveMacro dispatches to the right resolver", () => {
    expect(resolveMacro(detail, { tripId: detail.tripId }, "trip.name", {})).toEqual({ status: "ok", value: "T" });
  });
  it("resolveMacro reports unknown macros without throwing", () => {
    expect(resolveMacro(detail, { tripId: detail.tripId }, "nope.nope", {}).status).toBe("unknown");
  });
  it("resolveMacro reports bad params without throwing", () => {
    expect(resolveMacro(detail, { tripId: detail.tripId }, "trip.name", { junk: 1 }).status).toBe("ok"); // strip() ignores extras
  });
  it("macroCatalog exposes what the AI tools and the insert sidebar read", () => {
    // `shape` replaced `kind` on PR 134 (ADR-037 decision 1 — "inline"|"block"
    // had nowhere to put a repeater), and `title`/`preview` joined it because
    // the sidebar lists a widget by the name a person calls it and shows a
    // fixed sample beside it.
    const cat = macroCatalog();
    expect(cat.find((m) => m.name === "cost.trip")).toMatchObject({
      shape: "single",
      title: expect.any(String),
      description: expect.any(String),
      preview: expect.any(String),
    });
  });

  it("gives every widget a title and a preview, since the sidebar lists both", () => {
    for (const entry of macroCatalog()) {
      expect(entry.title, `${entry.name} has no title`).toBeTruthy();
      expect(entry.preview, `${entry.name} has no preview`).toBeTruthy();
      // The title is what a person reads; it must not be the stored identifier.
      expect(entry.title, `${entry.name}'s title is just its name`).not.toBe(entry.name);
    }
  });

  // ADR-035 decision 2. These two guard the seam itself rather than any one
  // widget, so a widget added later is covered the day it lands — which is the
  // whole point of declaring inputs instead of hardcoding a control per widget.

  // A plausible value per input type, so the assertion below can actually
  // exercise each macro's own validator rather than just reading its keys.
  const SAMPLE: Record<WidgetInput["type"], unknown> = {
    day: { kind: "index", index: 0 },
    days: { from: { kind: "index", index: 0 }, through: { kind: "index", index: 1 } },
    person: "u1",
    // ONE tag, and a real `ActivityTag` member. This was `["Meal"]` — an array,
    // and capitalised when the enum is lowercase — written speculatively before
    // any widget declared a `tags` input, so nothing ever exercised it. The
    // first widget that did (`stop.line`) rejected it, which is this test
    // working: §18's table reads "every stop, or ONE", so a tag binding is a
    // single optional member, not a list, and "Meal" is not a member at all.
    tags: "meal",
    trip: "11111111-1111-1111-1111-111111111111",
    // The three ADR-039 decision 1 adds. Real members of their contract shapes,
    // not placeholders: a `CityRef` is a name, a `KindRef` is an `ActivityKind`
    // member, and a `DateRangeRef` is an ordered pair of `YYYY-MM-DD` dates —
    // an unordered one is refused, which is what makes this exercise each
    // primitive's own validator rather than just read its keys.
    city: "Tokyo",
    kind: "booked",
    dates: { from: "2026-08-01", through: "2026-08-03" },
  };

  it("every declared input names a key its own macro's params schema accepts", () => {
    const checked: string[] = [];
    for (const name of MACRO_NAMES) {
      const def = getMacro(name)!;
      if (def.inputs.length === 0) continue;
      const bound = Object.fromEntries(def.inputs.map((i) => [i.name, SAMPLE[i.type]]));
      const parsed = def.params.safeParse(bound);
      // A declared input the validator drops is a binding the UI can set and
      // the resolver will never see — silent, and exactly the drift this seam
      // exists to prevent. `.strip()` makes that failure quiet, so assert the
      // key SURVIVES rather than merely that parsing succeeded.
      if (!parsed.success) throw new Error(`${name}: params rejected its own declared inputs`);
      for (const input of def.inputs) {
        expect(parsed.data as Record<string, unknown>).toHaveProperty(input.name);
      }
      checked.push(name);
    }
    // Non-vacuous: if every widget declared nothing, the loop above would pass
    // while asserting nothing at all. Containment, NOT equality — a new widget
    // that declares inputs must make this test cover more, never make it fail
    // (Copilot, PR 130). Exact equality would have contradicted the comment at
    // the top of this test the first time link 4 added a widget.
    expect(checked).toEqual(expect.arrayContaining(["cost.day", "itinerary.day"]));
  });

  it("declares inputs for every macro, with [] meaning 'binds nothing'", () => {
    // `[]` is a real answer, not a placeholder (ADR-035 decision 2) — it is what
    // makes a widget insert immediately with nothing to bind. So the field must
    // be present on all seven, and absence must be impossible rather than
    // indistinguishable from "binds nothing".
    for (const name of MACRO_NAMES) {
      expect(Array.isArray(getMacro(name)!.inputs), `${name} declares no inputs array`).toBe(true);
    }
  });
});

// ADR-037 decision 2, and the control it names by hand: **"a registry-wide test
// asserts every widget has a renderer, so 'forgot to wire it up' is a red test
// rather than a `no renderer:` chip discovered by a user."**
//
// That chip was real: `MacroView`'s `switch (name)` had a `default:` branch
// rendering `no renderer: <name>` to whoever opened the page. These tests are
// what replaces it, and they are registry-wide on purpose — a widget added
// tomorrow is covered the day it lands, without anyone remembering to add a case
// here either.
describe("every widget renders (ADR-037 decision 2)", () => {
  // A trip with enough in it that the block widgets resolve to `ok` rather than
  // `empty` — an `empty` outcome never reaches `render`, so a registry sweep
  // over a bare trip would pass while proving nothing about the renderers.
  const populated: TripDetail = {
    ...detail,
    startDate: "2026-08-01",
    days: [{ dayId: "d0", activityIds: ["a1"], date: "2026-08-01", costSubtotal: 5000 }],
    activities: {
      a1: {
        activityId: "a1", tripId: detail.tripId, title: "Museum", dayId: "d0", position: 0,
        timeWindow: { start: "09:00", end: "17:00" }, location: null,
        cost: { amountMinor: 5000, currency: "USD" },
        // `booked`, not `null`: `booking.line` resolves to `empty` for a day
        // whose stops are all merely planned, so with a null kind it never
        // reached `render` and the witness floor refused — the floor working,
        // again, rather than a reason to lower it.
        notes: null, kind: "booked", tags: [],
      },
    } as unknown as TripDetail["activities"],
    tripCostTotal: 5000,
    // `budget.remaining` resolves to `empty` without a budget, and a timeless
    // activity leaves `day.window` empty too. Both were added when those two
    // widgets landed and the witness floor below refused to be met — which is
    // the floor working: a widget that cannot reach `render` against a
    // populated trip is one nobody has proved renders.
    budget: { amountMinor: 100000, currency: "USD" },
    budgetRemaining: 95000,
  };

  // `day.city` reads its cities from the globals projection rather than from
  // `TripDetail` (they are derived by `citiesOfDay` in `@tc/domain`, which this
  // package may not import). The sweep passed `globals: null` while nothing
  // consumed it; now something does.
  const globals = {
    days: [{ index: 0, date: "2026-08-01", cities: ["Tokyo"], activityCount: 1, costSubtotal: 5000 }],
    cities: [{ name: "Tokyo", dayIndexes: [0], activityCount: 1 }],
    tags: [],
    bookedCount: 0,
  };

  // A loaded account. The sweep below needs one: `account.name` and
  // `account.homeAirport` resolve to `empty()` without it, so they would never
  // reach `render` and the witness floor would fail — which is the floor doing
  // exactly its job rather than a reason to lower it.
  const user = { displayName: "Priya", homeAirport: "SFO", distanceUnit: "km" as const };

  it("declares a render function for every registered widget", () => {
    for (const name of MACRO_NAMES) {
      expect(typeof getMacro(name)!.render, `${name} has no render`).toBe("function");
    }
  });

  it("produces a Rendered of a known kind for every widget that resolves", () => {
    const seen: string[] = [];
    for (const name of MACRO_NAMES) {
      const def = getMacro(name)!;
      // Bind anything that takes a day to the one day above, so block widgets
      // reach `ok` instead of `unbound`.
      const params = def.inputs.some((i) => i.type === "day") ? { dayRef: { kind: "index", index: 0 } } : {};
      const outcome = renderMacro({ trip: populated, page: { tripId: populated.tripId }, user, globals }, name, params);
      if (outcome.status !== "ok") continue;
      seen.push(name);
      expect(["inline", "block", "rows"], `${name} rendered an unknown kind`).toContain(outcome.rendered.kind);
    }
    // The witness. Without this the loop above passes when every widget
    // resolves to `empty` and nothing is rendered at all — the insensitive-test
    // failure this repo has already had twice (CLAUDE.md rule 3).
    expect(seen.length, `only ${seen.length} widget(s) reached render`).toBeGreaterThanOrEqual(MACRO_NAMES.length);
  });

  it("emits only text and chip segments — a widget has nowhere to put markup", () => {
    // ADR-037 decision 3a. Not a policy the renderers are asked to follow: the
    // `Seg` union has no member that can carry an element, an attribute or a
    // URL, and this asserts the widgets stay inside it.
    let inspected = 0;
    for (const name of MACRO_NAMES) {
      const def = getMacro(name)!;
      const params = def.inputs.some((i) => i.type === "day") ? { dayRef: { kind: "index", index: 0 } } : {};
      const outcome = renderMacro({ trip: populated, page: { tripId: populated.tripId }, user, globals }, name, params);
      if (outcome.status !== "ok" || outcome.rendered.kind === "block") continue;
      const segs = outcome.rendered.kind === "inline" ? outcome.rendered.segs : outcome.rendered.rows.flat();
      inspected += segs.length;
      for (const seg of segs) expect(["text", "chip"]).toContain(seg.kind);
    }
    // This sweep skips every block, so without a floor it passes when every
    // widget is one and no segment is examined at all — the same insensitivity
    // the main sweep's floor exists for. CodeRabbit caught that both
    // conditional sweeps here were missing their own (#134).
    expect(inspected, "no segment was inspected").toBeGreaterThan(0);
  });

  it("gives every block payload a `kind`, which is what BlockView dispatches on", () => {
    // The other half of deleting the name switch: `apps/web` picks a component
    // by payload shape, so a payload with no discriminator is a block nothing
    // can render.
    let inspected = 0;
    for (const name of MACRO_NAMES) {
      const def = getMacro(name)!;
      const params = def.inputs.some((i) => i.type === "day") ? { dayRef: { kind: "index", index: 0 } } : {};
      const outcome = renderMacro({ trip: populated, page: { tripId: populated.tripId }, user, globals }, name, params);
      if (outcome.status !== "ok" || outcome.rendered.kind !== "block") continue;
      inspected += 1;
      expect(typeof outcome.rendered.block.kind, `${name}'s block payload has no kind`).toBe("string");
    }
    // The mirror image: this one skips every NON-block, so it passes when no
    // widget renders as a block and nothing is examined.
    expect(inspected, "no block payload was inspected").toBeGreaterThan(0);
  });
});

// **The registry-wide test ADR-039 asks for by name.** Its consequences say the
// legality matrix "needs a registry-wide test in the shape of the ones that
// already guard the input/params correspondence" — the ones directly above —
// and this is that shape applied to `entity + filters`.
//
// It sweeps `PRIMITIVE_NAMES` rather than a list written here, so a primitive
// added tomorrow is covered the day it lands. The seventeen named widgets are
// deliberately outside it: they declare no `selection` and spell their day
// binding `dayRef`, and spec §8 step 3 is what turns them into presets over
// these.
describe("every primitive declares a legal selection (ADR-039 decision 3)", () => {
  // A real value per dimension, so each assertion exercises the primitive's own
  // validator rather than reading its keys. Same argument as `SAMPLE` above.
  const VALUE: Record<FilterDimensionType, unknown> = {
    day: { kind: "index", index: 0 },
    city: "Tokyo",
    tag: "meal",
    kind: "booked",
    person: "u1",
    dates: { from: "2026-08-01", through: "2026-08-03" },
  };

  it("covers the eleven primitives, and only widgets that declare a selection", () => {
    // Non-vacuous, and containment rather than equality: `attribute` is step 2
    // of the spec's order of work and must make this sweep cover MORE, never
    // make it fail (the rule Copilot set on PR 130).
    expect(PRIMITIVE_NAMES).toEqual(
      expect.arrayContaining([
        "cost", "count", "dates", "hours", "city",
        "day.detail", "city.detail",
        "day.rows", "city.rows", "stop.rows", "cost.rows",
      ]),
    );
    for (const name of PRIMITIVE_NAMES) expect(getMacro(name)!.selection).toBeDefined();
    // The named widgets are not primitives yet, and saying so out loud is what
    // makes this sweep's silence about them deliberate rather than a gap.
    expect(PRIMITIVE_NAMES).not.toContain("cost.day");
  });

  it("declares only dimensions its entity permits", () => {
    // The matrix as a wall: *"the hours of a city, the names of every stop on a
    // trip as one sentence"* are cells that mean nothing, and a primitive
    // reaching one fails here rather than shipping a control that resolves
    // against nothing.
    for (const name of PRIMITIVE_NAMES) {
      const { entity, filters } = getMacro(name)!.selection!;
      for (const dimension of filters) {
        expect(LEGAL_FILTERS[entity], `${name} declares ${dimension}, illegal for ${entity}`).toContain(dimension);
      }
    }
  });

  it("keeps every declared dimension a param its own schema accepts and keeps", () => {
    // The correspondence, forwards. A declared dimension the validator drops is
    // a filter the picker can set and the resolver will never see — silent,
    // because `.strip()` makes that failure quiet. So assert the key SURVIVES,
    // not merely that parsing succeeded.
    let checked = 0;
    for (const name of PRIMITIVE_NAMES) {
      const def = getMacro(name)!;
      const bound = Object.fromEntries(def.selection!.filters.map((d) => [d, VALUE[d]]));
      const parsed = def.params.safeParse(bound);
      if (!parsed.success) throw new Error(`${name}: params rejected its own declared filters — ${parsed.error.message}`);
      for (const dimension of def.selection!.filters) {
        expect(parsed.data as Record<string, unknown>, `${name} drops ${dimension}`).toHaveProperty(dimension);
        checked += 1;
      }
    }
    expect(checked, "no dimension was checked").toBeGreaterThan(0);
  });

  it("refuses a dimension it did not declare", () => {
    // The correspondence, backwards, and the half that catches the real drift:
    // a primitive whose schema quietly accepts `person` while its declaration
    // says it does not is a widget offering a filter nothing honours. Every
    // dimension NOT declared must be stripped.
    let checked = 0;
    for (const name of PRIMITIVE_NAMES) {
      const def = getMacro(name)!;
      const declared = new Set<string>(def.selection!.filters);
      const undeclared = FilterDimension.options.filter((d) => !declared.has(d));
      const parsed = def.params.parse(Object.fromEntries(undeclared.map((d) => [d, VALUE[d]])));
      for (const dimension of undeclared) {
        expect(parsed as Record<string, unknown>, `${name} keeps undeclared ${dimension}`).not.toHaveProperty(dimension);
        checked += 1;
      }
    }
    expect(checked, "every primitive declared every dimension, so nothing was checked").toBeGreaterThan(0);
  });

  it("derives one control per declared dimension, and no others", () => {
    // SPEC §5: *"the chrome row is generated from the primitive's declared
    // filters — one control per dimension, including the ones you have not
    // set"*, and *"both surfaces read one declaration, so they cannot offer
    // different things"*. A primitive whose `inputs` and `filters` disagree is
    // exactly two declarations.
    for (const name of PRIMITIVE_NAMES) {
      const def = getMacro(name)!;
      expect(def.inputs.map((i) => i.name), `${name}'s controls`).toEqual([...def.selection!.filters]);
    }
  });

  it("gives every registered widget a title and a preview, catalogued or not", () => {
    // `macroCatalog()` lists only the browsable widgets (ADR-039 decision 5),
    // so the catalogue sweep above stopped covering the primitives the moment
    // they were registered. The chrome row reads `title` and the phone's bind
    // sheet reads `preview` straight off the def, for any widget on a page.
    for (const name of MACRO_NAMES) {
      const def = getMacro(name)!;
      expect(def.title, `${name} has no title`).toBeTruthy();
      expect(def.preview, `${name} has no preview`).toBeTruthy();
      expect(def.title, `${name}'s title is just its name`).not.toBe(name);
    }
  });

  it("refuses a bad filter value at insert, with the typed refusal", () => {
    // ADR-039 decision 3's other half: *"`insertWidget` refuses the rest, with
    // the same typed refusal it uses for bad params today"*. There is still
    // exactly one way a widget enters a document (ADR-037 decision 4), so the
    // vocabulary is enforced at the same door as everything else.
    expect(insertWidget("cost", { kind: "booked" }).ok).toBe(true);
    const invented = insertWidget("cost", { kind: "reserved" });
    expect(invented.ok).toBe(false);
    expect(invented.ok === false && invented.error.reason).toBe("bad-params");
    const reversed = insertWidget("cost", { dates: { from: "2027-06-04", through: "2027-06-01" } });
    expect(reversed.ok, "a reversed date range").toBe(false);
    // A dimension the primitive does not declare is stripped rather than
    // refused — `.strip()` is what lets a document written by a later build
    // still open — so the node lands with the filter simply absent.
    const stripped = insertWidget("city.rows", { kind: "booked" });
    expect(stripped.ok).toBe(true);
    expect(stripped.ok === true && stripped.node.attrs.params).not.toHaveProperty("kind");
  });
});
