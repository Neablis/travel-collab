import { describe, expect, it } from "vitest";
import type { FilterDimension as FilterDimensionType, TripDetail } from "@tc/contracts";
import { FilterDimension } from "@tc/contracts";
import { distinctApplies, getMacro, renderMacro, MACRO_NAMES, PRIMITIVE_NAMES, primitiveCatalog } from "./registry";
import { presetCatalog } from "./presets";
import { LEGAL_FILTERS } from "./filters";
import { fieldChoices } from "./fields";
import { insertWidget } from "./insert";
import type { WidgetInput } from "./registry-types";

const detail = { tripId: "11111111-1111-1111-1111-111111111111", name: "T", startDate: null, currency: "USD", budget: null, status: "active", members: [{ userId: "u1", role: "owner" }], forkedFrom: null, days: [], backlog: [], activities: {}, conflicts: [], dismissedConflictIds: [], createdAt: "2026-07-20T00:00:00.000Z", unscheduledCostSubtotal: 0, tripCostTotal: 0, budgetRemaining: null } as TripDetail;

describe("registry", () => {
  it("registers the twelve primitives plus `open`, keyed by name, and nothing else", () => {
    // The seventeen NAMED widgets are gone (ADR-039 decision 4 — a named widget
    // is a preset, which is data). Asserting their absence is the half that
    // matters: a registry that still answered to `cost.day` would let a page
    // keep an un-migrated node forever and nobody would find out.
    //
    // **`open` is the thirteenth entry and the twelve primitives are still
    // twelve** (SPEC §25). It is a registered widget that declares no
    // `selection`, which is the distinction ADR-039 decision 1 actually draws:
    // a primitive is `entity + filters + shape`, and `open` has no entity to
    // narrow — it is the trip's whole open list by definition. So it is in
    // `MACRO_NAMES` and deliberately NOT in `PRIMITIVE_NAMES`, and the sweep
    // below that once equated the two is what caught it.
    // `country.facts` ("Know before you go", M14 link 11) is registered on
    // `open`'s terms: no selection, so not a primitive. `day.sun` and
    // `day.fromHome` (the same link) ARE primitives — day entity, day filters —
    // and so is `day.weather`, which also declares `needs` (ADR-052).
    expect([...MACRO_NAMES].sort()).toEqual([
      "attribute", "city", "city.detail", "city.rows", "cost", "cost.chart", "cost.rows",
      "count", "country.facts", "dates", "day.detail", "day.fromHome", "day.rows", "day.sun", "day.weather", "field", "hours",
      "open", "stop.rows", "trip.strip",
    ]);
    for (const name of MACRO_NAMES) expect(getMacro(name)!.name).toBe(name);
  });
  // `renderMacro` is the one dispatcher. `resolveMacro` sat beside it with only
  // these tests calling it, and was deleted (KI-2026-09-05-i item 2).
  const ctx = { trip: detail, page: { tripId: detail.tripId }, user: null, globals: null, today: null };
  it("renderMacro dispatches to the right resolver", () => {
    expect(renderMacro(ctx, "attribute", { field: "trip.name" })).toEqual({
      status: "ok",
      rendered: { kind: "inline", segs: [{ kind: "chip", name: "value", text: "T" }] },
    });
  });
  it("renderMacro reports unknown macros without throwing", () => {
    expect(renderMacro(ctx, "nope.nope", {}).status).toBe("unknown");
  });
  it("reports a RETIRED name as unknown rather than resolving it", () => {
    // A node still carrying `cost.day` reached this build without going through
    // `parsePageDoc`, which is a bug in the caller, not a page to render
    // silently. `MacroView` has a legible answer for `unknown`.
    expect(renderMacro(ctx, "cost.day", {}).status).toBe("unknown");
  });
  it("renderMacro reports bad params without throwing", () => {
    expect(renderMacro(ctx, "cost", { junk: 1 }).status).toBe("empty"); // strip() ignores extras
    expect(renderMacro(ctx, "cost", { kind: "reserved" }).status).toBe("bad-params");
  });
  it("presetCatalog exposes what the picker and the slash menu read", () => {
    const cat = presetCatalog();
    expect(cat.find((m) => m.name === "cost")).toMatchObject({
      widget: "cost",
      shape: "single",
      title: expect.any(String),
      description: expect.any(String),
      preview: expect.any(String),
    });
  });

  it("gives every preset a title and a preview, since the picker lists both", () => {
    for (const entry of presetCatalog()) {
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
    person: "u1",
    // ONE tag, and a real `ActivityTag` member. This was `["Meal"]` — an array,
    // and capitalised when the enum is lowercase — written speculatively before
    // any widget declared a `tags` input, so nothing ever exercised it. The
    // first widget that did (`stop.line`) rejected it, which is this test
    // working: §18's table reads "every stop, or ONE", so a tag binding is a
    // single optional member, not a list, and "Meal" is not a member at all.
    tags: "meal",
    // A manifest path, the only shape a `field` param stores.
    field: "stop.title",
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
      // A `multiple` field input stores a list of what the single one stores.
      const sampleOf = (i: WidgetInput) => (i.type === "field" && i.multiple ? [SAMPLE.field] : SAMPLE[i.type]);
      const bound = Object.fromEntries(def.inputs.map((i) => [i.name, sampleOf(i)]));
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
    expect(checked).toEqual(expect.arrayContaining(["cost", "day.detail"]));
  });

  it("declares inputs for every macro, with [] meaning 'binds nothing'", () => {
    // `[]` is a real answer, not a placeholder (ADR-035 decision 2) — it is what
    // makes a widget insert immediately with nothing to bind, and `attribute`
    // is the one that answers it. So the field must be present on every def,
    // and absence must be impossible rather than indistinguishable from
    // "binds nothing".
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
    // `a3` is a `hold` on the day: "Still to book" is bound to this day below
    // and resolved to `empty` without one — the floor refusing a fourth time.
    days: [{ dayId: "d0", activityIds: ["a1", "a3"], date: "2026-08-01", costSubtotal: 5000 }],
    activities: {
      a1: {
        activityId: "a1", tripId: detail.tripId, title: "Museum", dayId: "d0", position: 0,
        // Located, so "Know before you go" has a country to card rather than
        // resolving to `empty` — the witness floor below, once more.
        timeWindow: { start: "09:00", end: "17:00" }, location: { name: "Tokyo National Museum", countryCode: "JP" },
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
    // `open` resolves to `empty` on a trip with nothing waiting — which is the
    // honest answer for a settled trip, and means it never reaches `render`
    // against a fixture that has no open items. Same floor, working the same
    // way as the two notes above: one parked idea is what makes the widget mean
    // something, so the fixture carries one.
    backlog: ["a2"],
  };
  // Deliberately outside the object literal above: `activities` is cast
  // through `unknown` there, so an entry added inside it would be unchecked.
  populated.activities = {
    ...populated.activities,
    a2: {
      activityId: "a2", tripId: detail.tripId, title: "Ghibli Museum", dayId: null, position: 0,
      timeWindow: null, location: null, cost: null, notes: null, kind: "idea", tags: [],
    },
    a3: {
      activityId: "a3", tripId: detail.tripId, title: "Tea ceremony", dayId: "d0", position: 1,
      timeWindow: null, location: null, cost: null, notes: null, kind: "hold", tags: [],
    },
  } as unknown as TripDetail["activities"];

  // `day.city` reads its cities from the globals projection rather than from
  // `TripDetail` (they are derived by `citiesOfDay` in `@tc/domain`, which this
  // package may not import). The sweep passed `globals: null` while nothing
  // consumed it; now something does.
  //
  // The day's place and zone, and the reader's home zone, are what the server
  // computes for "Sunrise and sunset" and "Time difference from home": without
  // them both answer `empty` and the floor refuses, as above.
  const globals = {
    days: [{
      index: 0, date: "2026-08-01", cities: ["Tokyo"], activityCount: 1, costSubtotal: 5000,
      place: { lat: 35.7188, lng: 139.7765 }, timeZone: "Asia/Tokyo",
    }],
    cities: [{ name: "Tokyo", dayIndexes: [0], activityCount: 1 }],
    tags: [],
    bookedCount: 0,
    homeTimeZone: "America/Los_Angeles",
  };

  // A loaded account. The sweep below needs one: `account.name` and
  // `account.homeAirport` resolve to `empty()` without it, so they would never
  // reach `render` and the witness floor would fail — which is the floor doing
  // exactly its job rather than a reason to lower it.
  const user = { displayName: "Priya", homeAirport: "SFO", distanceUnit: "km" as const };

  // What the weather route would hand in for the day (ADR-052): with no slot
  // "Weather" answers `unavailable` and never reaches `render` — the floor
  // refusing, as above. The day is before `today` below, so this is the
  // labelled-typical row.
  const external = {
    weather: {
      state: "ready" as const,
      value: {
        points: [{
          date: "2026-08-01", city: "Tokyo", forecast: { unavailable: "not-in-horizon" as const },
          typical: {
            source: "nasa-power" as const, month: 8, highC: 31, lowC: 24, precipitationMmPerDay: 4.8,
            period: { fromYear: 2001, throughYear: 2020 },
          },
        }],
      },
    },
  };

  // **The sweep runs over PRESETS, not over registered names.** A primitive
  // asked to render with `{}` is not always meaningful — `attribute` with no
  // field chosen has nothing to read and correctly answers `empty()` — so a
  // bare registry sweep could only reach eleven of twelve and the witness floor
  // below would have to be lowered to accommodate a widget nobody had proved
  // renders. A preset carries the params that make its widget mean something,
  // which is exactly what the person clicking it gets.
  const presetOutcome = (entry: ReturnType<typeof presetCatalog>[number]) =>
    renderMacro(
      { trip: populated, page: { tripId: populated.tripId }, user, globals, today: "2027-06-01", external },
      entry.widget,
      // Bind anything still asking for a day to the one day above, so block
      // widgets reach `ok` instead of `unbound`. A field the preset leaves for
      // the reader to pick gets the manifest's first, which is what the picker
      // would offer at the top.
      {
        ...entry.params,
        ...(entry.inputs.some((i) => i.type === "day") ? { day: { kind: "index", index: 0 } } : {}),
        ...Object.fromEntries(
          entry.inputs.flatMap((i) => (i.type === "field" && !i.multiple ? [[i.name, fieldChoices(i.of)[0]!.path]] : [])),
        ),
      },
    );

  it("produces a Rendered of a known kind for every preset that resolves", () => {
    const seen: string[] = [];
    for (const entry of presetCatalog()) {
      const outcome = presetOutcome(entry);
      if (outcome.status !== "ok") continue;
      seen.push(entry.name);
      expect(["inline", "block", "rows"], `${entry.name} rendered an unknown kind`).toContain(outcome.rendered.kind);
    }
    // The witness, and it is EVERY preset rather than a floor plucked from the
    // air: a row a person can click that cannot render against a trip with a
    // day, a stop, a cost, a budget, a city and an account is a row that should
    // not be in the picker. Without this the loop above passes when every
    // preset resolves to `empty` and nothing is rendered at all — the
    // insensitive-test failure this repo has already had twice (CLAUDE.md
    // rule 3).
    expect(seen, "a preset in the picker never reached render").toEqual(
      presetCatalog().map((entry) => entry.name),
    );
    expect(seen.length).toBeGreaterThanOrEqual(12);
  });

  it("declares a render function for every registered primitive", () => {
    for (const name of MACRO_NAMES) {
      expect(typeof getMacro(name)!.render, `${name} has no render`).toBe("function");
    }
  });

  it("emits only text and chip segments — a widget has nowhere to put markup", () => {
    // ADR-037 decision 3a. Not a policy the renderers are asked to follow: the
    // `Seg` union has no member that can carry an element, an attribute or a
    // URL, and this asserts the widgets stay inside it.
    let inspected = 0;
    for (const entry of presetCatalog()) {
      const outcome = presetOutcome(entry);
      if (outcome.status !== "ok" || outcome.rendered.kind === "block") continue;
      const segs =
        outcome.rendered.kind === "inline"
          ? outcome.rendered.segs
          : outcome.rendered.rows.flatMap((row) => [...row.lead, ...row.cells.flat()]);
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
    for (const entry of presetCatalog()) {
      const outcome = presetOutcome(entry);
      if (outcome.status !== "ok" || outcome.rendered.kind !== "block") continue;
      inspected += 1;
      expect(typeof outcome.rendered.block.kind, `${entry.name}'s block payload has no kind`).toBe("string");
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

  it("covers the twelve primitives, and only widgets that declare a selection", () => {
    // Non-vacuous, and containment rather than equality: a primitive added later
    // must make this sweep cover MORE, never make it fail (the rule Copilot set
    // on PR 130).
    expect(PRIMITIVE_NAMES).toEqual(
      expect.arrayContaining([
        "cost", "count", "dates", "hours", "city", "attribute",
        "day.detail", "city.detail",
        "day.rows", "city.rows", "stop.rows", "cost.rows",
      ]),
    );
    for (const name of PRIMITIVE_NAMES) expect(getMacro(name)!.selection).toBeDefined();
    // **The two lists are no longer equal, and that is the point of keeping
    // them separate.** This used to assert `PRIMITIVE_NAMES === MACRO_NAMES`,
    // with a comment calling it "the state ADR-039 was aiming at". `open`
    // (SPEC §25) is registered and declares no selection, exactly the case
    // `PRIMITIVE_NAMES`' own doc comment predicted — *"a widget added tomorrow
    // without one should drop out of those sweeps and fail the count beside
    // them"*. It did, on the first run. So the invariant is restated as the
    // containment it always meant: every primitive is registered, and a
    // registered widget without a selection is not a primitive.
    expect([...MACRO_NAMES].sort()).toEqual(expect.arrayContaining([...PRIMITIVE_NAMES].sort()));
    expect(MACRO_NAMES.filter((n) => getMacro(n)!.selection === undefined).sort()).toEqual(["country.facts", "open", "trip.strip"]);
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

  it("declares no `person` input anywhere — the M14 gate box", () => {
    // *"No `w-person` or `w-personline` … nothing in the registry declares a
    // `person` input."* Mitchell, 2026-09-24: *"person is removed for now"*.
    // Swept over every registered widget, not the three that used to carry it,
    // so one added later cannot bring the control back unnoticed. The contract
    // enum keeps the member; this is about what the registry offers.
    let checked = 0;
    for (const name of MACRO_NAMES) {
      const def = getMacro(name)!;
      expect(def.inputs.map((i) => i.type), `${name} declares a person input`).not.toContain("person");
      expect(def.selection?.filters ?? [], `${name} selects by person`).not.toContain("person");
      checked += 1;
    }
    expect(checked).toBe(MACRO_NAMES.length);
    expect(checked).toBeGreaterThanOrEqual(13);
  });

  it("derives one control per declared dimension, and no others", () => {
    // SPEC §5: *"the chrome row is generated from the primitive's declared
    // filters — one control per dimension, including the ones you have not
    // set"*, and *"both surfaces read one declaration, so they cannot offer
    // different things"*. A primitive whose `inputs` and `filters` disagree is
    // exactly two declarations.
    //
    // **A `field` input is not a control over a dimension**, so it is left out
    // of the comparison: it chooses what a widget reads, not which members, and
    // no filter maps to it (`WidgetInput`'s own comment).
    for (const name of PRIMITIVE_NAMES) {
      const def = getMacro(name)!;
      const filterControls = def.inputs.filter((i) => i.type !== "field").map((i) => i.name);
      expect(filterControls, `${name}'s controls`).toEqual([...def.selection!.filters]);
    }
  });

  it("names each primitive's non-filter params and their vocabularies", () => {
    // The catalogue is what the assistant composes from, and it described every
    // widget as a selection plus filters — false for the two primitives that
    // take something else. A model told "every param is a filter" cannot ask
    // for the trip's name, so `attribute` was uninsertable by the AI path
    // (Copilot, PR 141).
    const catalogue = primitiveCatalog();
    const paramsOf = (name: string) => catalogue.find((entry) => entry.name === name)!.params;
    // Derived from the schema, so the vocabulary is the enum's own — a fifth
    // `AttributeFieldRef` member reaches the model with no edit anywhere.
    expect(paramsOf("attribute")).toEqual({
      field: ["trip.name", "trip.budgetRemaining", "trip.countdown", "account.name", "account.homeAirport"],
    });
    expect(paramsOf("count")).toEqual({ of: ["stop", "day", "city"] });
    // "Still to book" is `stop.rows` plus this param, so a model can compose it
    // without the preset list — with no edit to the catalogue to get there.
    // `columns` is a field input, so its vocabulary is the manifest's paths.
    expect(paramsOf("stop.rows")).toEqual({ only: ["needsBooking"], columns: fieldChoices("stop").map((c) => c.path) });
    // And a primitive that takes only filters says so with an empty object
    // rather than by omission, so "no extra params" is a statement.
    expect(paramsOf("cost")).toEqual({});
    // Non-vacuous the other way: the filter dimensions must NOT leak in here,
    // or every widget would look like it took ten extra params.
    for (const entry of catalogue) {
      for (const key of Object.keys(entry.params)) {
        expect(FilterDimension.options, `${entry.name} lists the filter ${key} as an extra param`).not.toContain(key);
      }
    }
  });

  it("hands the assistant every valid field, by path and label, for a widget with a `field` input", () => {
    // Gap 5 of the M14 field-widget review: `nonFilterParams` read only `ZodEnum`
    // values, and a field param is a plain string (validated at resolve time,
    // so a stale one never blocks a save), so the model would have been told
    // "any string" and guessed.
    //
    // Read off the REGISTERED catalogue, the one `handleAskRequest` sends, so
    // the field widget reaching the assistant is proved rather than a test-only
    // def's entry (M14 T10).
    const catalogue = primitiveCatalog();
    const entry = catalogue.find((e) => e.name === "field")!;
    const choices = fieldChoices("stop");
    expect(choices.length, "the stop root publishes nothing").toBeGreaterThan(0);
    // `distinct` is a boolean, so it has no list to give.
    expect(entry.params).toEqual({ field: choices.map((c) => c.path), distinct: null });
    expect(entry.fields).toEqual({ field: choices.map(({ path, label }) => ({ path, label })) });
    // And a widget with no field input carries no `fields` key at all: the
    // catalogue rides in every page turn's prompt, so absence is the cheap
    // spelling of "none".
    const withFields = catalogue.filter((e) => e.fields !== undefined).map((e) => e.name);
    expect(withFields.sort()).toEqual(["field", "stop.rows"]);
    // `stop.rows`' columns, from the same manifest and marked as a list.
    const rows = catalogue.find((e) => e.name === "stop.rows")!;
    expect(rows.fields).toEqual({ columns: choices.map(({ path, label }) => ({ path, label })) });
    expect(rows.inputs).toContainEqual({ name: "columns", type: "field", label: "Columns", of: "stop", multiple: true });
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
    // **A dimension the primitive does not declare is REFUSED, not stripped.**
    // Decision 3 says so outright — *"the picker offers only combinations that
    // are legal; `insertWidget` refuses the rest"* — and stripping meant a
    // caller's filter was discarded by the one function whose whole job is to
    // refuse bad input (Copilot, PR 141). `city.rows` selects over cities, and
    // a city has no kind.
    const illegal = insertWidget("city.rows", { kind: "booked" });
    expect(illegal.ok).toBe(false);
    expect(illegal.ok === false && illegal.error.reason).toBe("bad-params");
    // The message names the dimension and what the widget does accept, because
    // "bad params" alone tells a caller nothing it can act on.
    const message = illegal.ok === false && illegal.error.reason === "bad-params" ? illegal.error.message : "";
    expect(message).toContain("kind");
    expect(message).toContain("city");
    // Strict on the way IN, permissive on the way out: the read path still
    // strips, so a document written by a newer build still opens.
    expect(getMacro("city.rows")!.params.parse({ kind: "booked" })).not.toHaveProperty("kind");
    // And junk that is not a filter dimension at all still strips on insert —
    // this refuses illegal FILTERS, not unfamiliar keys.
    expect(insertWidget("city.rows", { somethingNewer: 1 }).ok).toBe(true);
  });
});

// Whether the editor offers "Remove duplicates" (M14 polish). Derived from the
// widget's own params schema and the chosen field's kind, never from a list of
// widget names or field paths.
describe("distinctApplies", () => {
  it("is true for a field widget reading a kind that lists", () => {
    const listing = fieldChoices("stop").filter((c) => ["text", "enum", "location"].includes(c.valueKind));
    expect(listing.length).toBeGreaterThan(0);
    for (const choice of listing) expect(distinctApplies("field", { field: choice.path }), choice.path).toBe(true);
  });

  it("is false for a field that sums or spans, for no field, and for one no longer published", () => {
    expect(distinctApplies("field", { field: "stop.cost" })).toBe(false);
    expect(distinctApplies("field", {})).toBe(false);
    expect(distinctApplies("field", { field: "stop.gone" })).toBe(false);
  });

  // `stop.rows` has field inputs too, but no `distinct` param: a table lists
  // one stop per row, so there is nothing to collapse.
  it("is false for every widget whose params do not declare `distinct`", () => {
    const declaring = PRIMITIVE_NAMES.filter((name) => {
      const shape = (getMacro(name)!.params as { shape?: Record<string, unknown> }).shape;
      return shape !== undefined && "distinct" in shape;
    });
    expect(declaring).toEqual(["field"]);
    for (const name of PRIMITIVE_NAMES.filter((n) => n !== "field")) {
      expect(distinctApplies(name, { field: "stop.title", columns: ["stop.title"] }), name).toBe(false);
    }
    expect(distinctApplies("nope", { field: "stop.title" })).toBe(false);
  });
});
