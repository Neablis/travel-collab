import { describe, expect, it } from "vitest";
import { WIDGET_NAME_MIGRATION, parsePageDoc } from "@tc/contracts";
import { PRESETS, getPreset, insertPreset, presetCatalog } from "./presets";
import { insertWidget } from "./insert";
import { MACRO_NAMES, getMacro, renderMacro } from "./registry";
import type { WidgetContext } from "./registry-types";
import { selectionTrip } from "./test-support/selectionTrip";

// **A preset is data, and this is what stops it being data that lies.**
//
// The preset table and the document migration are two lists that have to agree:
// one says what a person can pick, the other says what a stored `cost.day`
// becomes. ADR-039 wanted them generated from one list; `packages/contracts`
// may not import `@tc/pages`, so instead the migration map is the single
// authority for the MAPPING and the preset table is the single authority for
// the COPY — and these tests are the weld between them.

const contextOf = ({ trip, globals }: ReturnType<typeof selectionTrip>): WidgetContext => ({
  trip,
  page: { tripId: trip.tripId },
  user: { displayName: "Priya", homeAirport: "SFO", distanceUnit: "km" },
  globals,
});

describe("the preset table", () => {
  it("names a registered primitive on every row", () => {
    // A preset pointing at a widget that does not exist is a row the picker
    // silently drops — `presetCatalog` skips it rather than emptying the whole
    // list — so the failure has to be caught here or not at all.
    for (const preset of PRESETS) {
      expect(getMacro(preset.widget), `${preset.id} names ${preset.widget}, which is not registered`).toBeDefined();
    }
    expect(PRESETS.length).toBeGreaterThanOrEqual(12);
  });

  it("gives every row params its own primitive accepts and keeps", () => {
    // A preset whose params the primitive strips is a title promising a filter
    // nothing applies — "A line for every booking" listing every stop.
    for (const preset of PRESETS) {
      const def = getMacro(preset.widget)!;
      const parsed = def.params.safeParse(preset.params);
      if (!parsed.success) throw new Error(`${preset.id}: ${preset.widget} rejected its preset params`);
      for (const key of Object.keys(preset.params)) {
        expect(parsed.data as Record<string, unknown>, `${preset.id} loses ${key}`).toHaveProperty(key);
      }
    }
  });

  it("reaches every primitive, so nothing is registered and unreachable", () => {
    // The picker is the only way a person meets a widget. A primitive with no
    // preset is code nobody can run, which is the shape of KI-2026-09-02-d.
    const reached = new Set(PRESETS.map((p) => p.widget));
    expect([...reached].sort()).toEqual([...MACRO_NAMES].sort());
  });

  it("has a unique id per row, since the id is what the picker keys on", () => {
    const ids = PRESETS.map((p) => p.id);
    expect(new Set(ids).size, `duplicate preset id in ${ids.join(", ")}`).toBe(ids.length);
  });
});

describe("presets and the document migration agree", () => {
  it("leaves no retired name without somewhere to land", () => {
    // Every one of the seventeen migrates to a primitive, and every one of
    // those primitives has at least one preset. So a person who knew a widget
    // by its old name can still find something that does what it did.
    for (const [retired, step] of Object.entries(WIDGET_NAME_MIGRATION)) {
      const covering = PRESETS.filter((preset) => preset.widget === step.name);
      expect(covering.length, `${retired} became ${step.name}, which no preset offers`).toBeGreaterThan(0);
    }
  });

  it("gives a retired name to the preset that IS its combination, not to its siblings", () => {
    // `booking.line` meant `stop.rows` filtered to bookings. Grouping aliases
    // by primitive alone handed it to "A line for every stop" as well, so
    // searching a retired name surfaced a widget that is not what that name
    // used to do — and `account.homeAirport` surfaced all four `attribute`
    // presets (Copilot, PR 141).
    const aliasesOf = (id: string) => presetCatalog().find((e) => e.name === id)!.aliases;
    expect(aliasesOf("booking.line")).toEqual(["booking.line"]);
    expect(aliasesOf("stop.line")).toEqual(["stop.line"]);
    expect(aliasesOf("account.homeAirport")).toEqual(["account.homeAirport"]);
    expect(aliasesOf("account.name")).toEqual(["account.name"]);
    // A pair that genuinely collapsed onto one preset keeps BOTH names, which
    // is the case this must not over-correct: `cost.trip` and `cost.day` are
    // the same widget with and without a day.
    expect([...aliasesOf("cost")].sort()).toEqual(["cost.day", "cost.trip"]);
    // And a preset nothing migrates to has none rather than borrowing any.
    expect(aliasesOf("count.booked")).toEqual([]);
    expect(aliasesOf("day.detail.booked")).toEqual([]);
  });

  it("lists every retired name as a search alias of the preset it became", () => {
    // §6's last line: *"filter values are searchable through their presets,
    // which is how `/booking` still finds something after `booking.line` stops
    // existing"* — extended to the names, so `cost.day` finds "What it costs"
    // even though no preset is called that any more.
    const aliased = new Set(presetCatalog().flatMap((entry) => entry.aliases));
    expect([...aliased].sort()).toEqual(Object.keys(WIDGET_NAME_MIGRATION).sort());
  });

  it("renders every migrated v1 widget, params and all", () => {
    // The end-to-end claim, and the one a reader actually cares about: a page
    // written before ADR-039 still shows something afterwards. Each old name is
    // put through the real `parsePageDoc` migration and the result rendered
    // against a real trip.
    const fixture = selectionTrip();
    const ctx = contextOf(fixture);
    const rendered: string[] = [];
    for (const retired of Object.keys(WIDGET_NAME_MIGRATION)) {
      const doc = parsePageDoc({
        type: "doc",
        // A day binding on every one, spelled the v1 way. Widgets that took no
        // day strip it, which is itself worth exercising: `.strip()` is what
        // lets a stale param ride along without breaking the page.
        content: [{ type: "macro", attrs: { name: retired, params: { dayRef: { kind: "index", index: 0 } } } }],
      });
      const node = doc.content[0];
      if (node?.type !== "macro") throw new Error(`${retired} did not migrate to a macro node`);
      const outcome = renderMacro(ctx, node.attrs.name, node.attrs.params);
      expect(outcome.status, `${retired} → ${node.attrs.name} came back ${outcome.status}`).toBe("ok");
      rendered.push(retired);
    }
    // Non-vacuous: all seventeen, not "however many happened to work".
    expect(rendered).toHaveLength(17);
  });
});

describe("insertPreset", () => {
  it("inserts the primitive with the preset's own filters", () => {
    expect(insertPreset("booking.line")).toEqual({
      ok: true,
      node: { type: "macro", attrs: { name: "stop.rows", params: { kind: "booked" } } },
    });
  });

  it("lets a binding made at insert time win over the preset's", () => {
    // ADR-039 decision 4: *"rebinding a preset away from its params is not an
    // error state. It is just the general widget, which is what it always
    // was."* An author who picks "A line for every booking" and then chooses a
    // different kind gets that kind, not a refusal.
    const result = insertPreset("booking.line", { kind: "idea" });
    expect(result.ok && result.node.attrs.params).toEqual({ kind: "idea" });
  });

  it("goes through the one insert path, so a bad binding is still refused", () => {
    // ADR-037 decision 4 — there is exactly one way a widget enters a document,
    // and a preset is a shortcut for choosing its arguments, not a second door.
    const result = insertPreset("cost", { day: "day 2" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.reason).toBe("bad-params");
  });

  it("refuses a non-record override instead of spreading it away", () => {
    // `{ ...preset.params, ...null }` is a silent no-op, so this used to come
    // back `ok` carrying the preset's own `{ kind: "booked" }` — the caller's
    // input discarded by the path whose job is to refuse it (CodeRabbit, PR
    // 141). It is the same hole `insertWidget` closed on PR 139, reopened by
    // the spread one layer up, which is why the assertion is that BOTH doors
    // give the same answer rather than merely that this one refuses.
    const throughPreset = insertPreset("booking.line", null);
    expect(throughPreset.ok).toBe(false);
    expect(!throughPreset.ok && throughPreset.error.reason).toBe("bad-params");
    expect(insertWidget("stop.rows", null).ok).toBe(false);
  });

  it("refuses an unknown preset id with the same typed reason", () => {
    expect(insertPreset("nope.nope")).toEqual({
      ok: false,
      error: { reason: "unknown-widget", name: "nope.nope" },
    });
  });

  it("can insert every preset with nothing bound", () => {
    // Registry-wide: the picker offers every row, and a row that cannot be
    // clicked is worse than one that is missing.
    for (const preset of PRESETS) {
      expect(insertPreset(preset.id).ok, `${preset.id} cannot be inserted`).toBe(true);
    }
  });
});

describe("presetCatalog", () => {
  it("gives every primitive declaring `day` the `dates` dimension too", () => {
    // The property the UI's one-control collapse rests on, asserted over the
    // registry rather than the matrix: `widgetBind` drops the `day` input when
    // a `dates` one is present, so a primitive declaring `day` alone would lose
    // its only day control with nothing failing.
    let checked = 0;
    for (const preset of PRESETS) {
      const filters = getMacro(preset.widget)!.selection!.filters;
      if (!filters.includes("day")) continue;
      expect(filters, `${preset.widget} declares day but not dates`).toContain("dates");
      checked += 1;
    }
    expect(checked, "no primitive declares a day filter").toBeGreaterThan(0);
  });

  it("offers a control for every dimension the preset has not already answered", () => {
    // A preset that fixes `kind: "booked"` is "a line for every booking";
    // offering a kind select beside it invites the author to turn it into
    // something its own title contradicts. The dimension is still reachable —
    // that is what the unfiltered preset is for — but the row a person picked
    // by name should not immediately offer to unpick it.
    const booking = presetCatalog().find((e) => e.name === "booking.line")!;
    expect(booking.inputs.map((i) => i.name)).not.toContain("kind");
    expect(booking.inputs.map((i) => i.name)).toContain("day");
    const stops = presetCatalog().find((e) => e.name === "stop.line")!;
    expect(stops.inputs.map((i) => i.name)).toContain("kind");
  });

  it("falls through to the primitive's copy unless the preset overrides it", () => {
    const cost = presetCatalog().find((e) => e.name === "cost")!;
    expect(cost.description).toBe(getMacro("cost")!.description);
    expect(cost.preview).toBe(getPreset("cost")!.preview);
    expect(cost.preview).not.toBe(getMacro("cost")!.preview);
  });

  it("carries the shape, so the picker's filter row and its badges agree", () => {
    for (const entry of presetCatalog()) {
      expect(entry.shape, `${entry.name}`).toBe(getMacro(entry.widget)!.shape);
    }
  });
});
