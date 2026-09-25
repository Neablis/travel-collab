import { describe, expect, it } from "vitest";
import { MACRO_NAMES, getMacro, renderMacro } from "./registry";
import type { ItemScope, WidgetContext } from "./registry-types";
import { REPEAT_SCOPE_ORDER, SENTENCE_TEMPLATE_MAX, parseSentenceTemplate } from "@tc/contracts";
import { DEFAULT_SENTENCES, REPEAT_WIDGETS, insertRepeat, repeatLabel, repeatOver, rescopeRepeat, rescopeRows, resolveRepeat, unknownSentenceTokens, type RepeatOver } from "./repeat";
import { sentenceFieldAt, sentenceFields } from "./sentence";
import { findWidgetError } from "./writeCheck";
import { insertWidget } from "./insert";
import { PRESETS, insertPreset, presetCatalog } from "./presets";
import { selectionTrip } from "./test-support/selectionTrip";

// The authored repeat (ADR-035 decision 4, M14 link 6): a sentence the author
// writes once, rendered once per day, stop or city. Two halves are pinned here —
// which items a repeat yields (its selection is the rows primitive's, through
// `narrow`), and what a widget in its template reads when it is handed one.

function ctxOf(): { ctx: WidgetContext; ids: ReturnType<typeof selectionTrip>["ids"] } {
  const { trip, globals, ids } = selectionTrip();
  return { ctx: { trip, globals, page: { tripId: trip.tripId }, user: null, today: null }, ids };
}

const items = (outcome: ReturnType<typeof resolveRepeat>): readonly ItemScope[] => {
  if (outcome.status !== "ok") throw new Error(`expected items, got ${JSON.stringify(outcome)}`);
  return outcome.items;
};

describe("resolveRepeat — which items a repeat yields", () => {
  it("yields one item per day, stop or city the rows primitive would list", () => {
    const { ctx, ids } = ctxOf();
    expect(items(resolveRepeat(ctx, "day.rows", {}))).toEqual([0, 1, 2].map((index) => ({ kind: "day", index })));
    expect(items(resolveRepeat(ctx, "city.rows", {}))).toEqual([
      { kind: "city", name: "Rome" },
      { kind: "city", name: "Kyoto" },
    ]);
    expect(items(resolveRepeat(ctx, "stop.rows", { kind: "pending" }))).toEqual([
      { kind: "stop", activityId: ids.s0, dayIndex: 0 },
      { kind: "stop", activityId: ids.s3, dayIndex: 1 },
    ]);
  });

  it("narrows by the same filters as the rows primitive, `only` included", () => {
    const { ctx } = ctxOf();
    const june = items(resolveRepeat(ctx, "day.rows", { dates: { from: "2027-06-01", through: "2027-06-02" } }));
    expect(june).toEqual([
      { kind: "day", index: 0 },
      { kind: "day", index: 1 },
    ]);
    const toBook = items(resolveRepeat(ctx, "stop.rows", { only: "needsBooking" }));
    const listed = renderMacro(ctx, "stop.rows", { only: "needsBooking" });
    // As many items as the table has data rows — the two cannot disagree on which stops still need booking.
    expect(listed.status).toBe("ok");
    const dataRows = listed.status === "ok" && listed.rendered.kind === "rows"
      ? listed.rendered.rows.filter((row) => row.kind === undefined).length
      : -1;
    expect(toBook.length).toBe(dataRows);
    expect(toBook.length).toBeGreaterThan(0);
  });

  it("is empty — not unbound — when the selection holds nothing", () => {
    const { ctx } = ctxOf();
    expect(resolveRepeat(ctx, "day.rows", { dates: { from: "2031-01-01", through: "2031-01-02" } })).toMatchObject({
      status: "empty",
      over: "day",
      emptyText: getMacro("day.rows")!.emptyText,
    });
    expect(resolveRepeat({ ...ctx, globals: null }, "city.rows", {})).toMatchObject({ status: "empty", over: "city" });
  });

  it("says what it is waiting for, and refuses a name that is not a repeatable collection", () => {
    const { ctx } = ctxOf();
    expect(resolveRepeat({ ...ctx, trip: undefined }, "day.rows", {})).toMatchObject({ status: "unbound", needs: "trip" });
    expect(resolveRepeat(ctx, "stop.rows", { day: { kind: "index", index: 40 } })).toMatchObject({ status: "unbound", needs: "day" });
    expect(resolveRepeat(ctx, "cost", {})).toMatchObject({ status: "invalid" });
    expect(resolveRepeat(ctx, "day.rows", { day: "Tuesday" })).toMatchObject({ status: "invalid" });
  });

  it("is not fooled by a name every object inherits", () => {
    // A stored name is any string; `toString` on a plain lookup table is a
    // function, and the read-only fallback then threw rendering it.
    expect(repeatOver("day.rows")).toBe("day");
    for (const name of ["toString", "constructor", "__proto__", "hasOwnProperty"]) {
      expect(repeatOver(name), name).toBeNull();
      expect(resolveRepeat(ctxOf().ctx, name, {}), name).toMatchObject({ status: "invalid" });
    }
  });
});

describe("repeatLabel — the rail's words", () => {
  it("names what it repeats over and how many, in English", () => {
    expect(repeatLabel("day", 9)).toBe("For every day · 9 days");
    expect(repeatLabel("stop", 1)).toBe("For every stop · 1 stop");
    expect(repeatLabel("city", 0)).toBe("For every city · none yet");
    expect(repeatLabel("city", null)).toBe("For every city");
  });
});

describe("ItemScope — a widget in a template reads its item when it is not bound", () => {
  // The claim is exact, not approximate: an UNBOUND widget handed an item
  // renders precisely what the same widget renders explicitly bound to it. So
  // the item scope adds no second meaning of "this day" — it is the filter the
  // author did not have to set.
  const dayWidgets = MACRO_NAMES.filter((name) => getMacro(name)!.selection?.filters.includes("day"));

  it("a day item is the day filter, for every widget that takes one", () => {
    const { ctx } = ctxOf();
    let compared = 0;
    for (const name of dayWidgets) {
      for (const index of [0, 1, 2]) {
        const scoped = renderMacro(ctx, name, {}, { kind: "day", index });
        const bound = renderMacro(ctx, name, { day: { kind: "index", index } });
        expect(scoped, `${name} on day ${index + 1}`).toEqual(bound);
        compared++;
      }
    }
    // Witness: measured 2026-09-24 — every day-taking widget, three days each.
    expect(compared).toBe(dayWidgets.length * 3);
    expect(dayWidgets).toEqual(expect.arrayContaining(["dates", "city", "cost", "count", "day.detail", "field"]));
  });

  it("differs by item — the same template reads each day's own values", () => {
    const { ctx } = ctxOf();
    const on = (index: number) => renderMacro(ctx, "dates", {}, { kind: "day", index });
    expect(on(0)).toEqual({ status: "ok", rendered: { kind: "inline", segs: [{ kind: "chip", name: "value", text: "Jun 1, 2027" }] } });
    expect(on(1)).toEqual({ status: "ok", rendered: { kind: "inline", segs: [{ kind: "chip", name: "value", text: "Jun 2, 2027" }] } });
    // Day 3 has no date: the widget's own empty answer, not the trip's range.
    expect(on(2)).toEqual({ status: "empty" });
  });

  it("an explicit binding beats the item", () => {
    const { ctx } = ctxOf();
    const pinned = renderMacro(ctx, "dates", { day: { kind: "index", index: 0 } }, { kind: "day", index: 1 });
    expect(pinned).toEqual(renderMacro(ctx, "dates", { day: { kind: "index", index: 0 } }));
  });

  it("a city item is the city filter — and the city widget prints that city", () => {
    const { ctx } = ctxOf();
    const kyoto: ItemScope = { kind: "city", name: "Kyoto" };
    expect(renderMacro(ctx, "cost", {}, kyoto)).toEqual(renderMacro(ctx, "cost", { city: "Kyoto" }));
    expect(renderMacro(ctx, "city", {}, kyoto)).toEqual({
      status: "ok",
      rendered: { kind: "inline", segs: [{ kind: "chip", name: "city", text: "Kyoto" }] },
    });
  });

  // The widgets that read WHERE a day is — weather at its points, the sun and
  // the clock at its place — on the fixture's Rome → Kyoto travel day, where
  // "the day" and "the city" are two different answers. The base fixture has
  // no places and no weather, which makes every one of them trivially equal
  // (all empty), so this context gives them something to disagree about.
  function locatedCtx(): { ctx: WidgetContext; ids: ReturnType<typeof ctxOf>["ids"] } {
    const { ctx, ids } = ctxOf();
    const rome = { place: { lat: 41.9, lng: 12.5, city: "Rome" }, timeZone: "Europe/Rome" };
    const typical = {
      source: "nasa-power", month: 6, highC: 28, lowC: 17, precipitationMmPerDay: 1.2,
      period: { fromYear: 2001, throughYear: 2020 },
    } as const;
    const at = (date: string, city: string) => ({
      date, city, forecast: { unavailable: "not-in-horizon" as const }, typical: { ...typical, highC: city === "Kyoto" ? 29 : 28 },
    });
    const located: WidgetContext = {
      ...ctx,
      today: "2027-05-01",
      globals: {
        ...ctx.globals!,
        days: ctx.globals!.days.map((day) => (day.date === null ? day : { ...day, ...rome })),
        homeTimeZone: "America/New_York",
      },
      external: {
        weather: {
          state: "ready",
          value: { points: [at("2027-06-01", "Rome"), at("2027-06-02", "Rome"), at("2027-06-02", "Kyoto")] },
        },
      },
    };
    return { ctx: located, ids };
  }

  it("a city item is the city filter for the widgets that read where a day is", () => {
    const { ctx } = locatedCtx();
    let compared = 0;
    for (const name of ["day.weather", "day.sun", "day.fromHome"]) {
      for (const city of ["Rome", "Kyoto"]) {
        const scoped = renderMacro(ctx, name, {}, { kind: "city", name: city });
        expect(scoped, `${name} for ${city}`).toEqual(renderMacro(ctx, name, { city }));
        // And the Kyoto line never prints Rome — its travel day's other city.
        if (city === "Kyoto") expect(JSON.stringify(scoped), `${name} for Kyoto`).not.toContain("Rome");
        compared++;
      }
    }
    // Witness: three widgets, two cities each.
    expect(compared).toBe(6);
    // The Rome line does have weather and a sun on both its days — the filter selects, it does not blank.
    const rome: ItemScope = { kind: "city", name: "Rome" };
    expect(renderMacro(ctx, "day.weather", {}, rome)).toMatchObject({
      status: "ok", rendered: { block: { rows: [{ city: "Rome" }, { city: "Rome" }] } },
    });
    expect(renderMacro(ctx, "day.sun", {}, rome)).toMatchObject({ status: "ok", rendered: { rows: [{}, {}] } });
  });

  it("a stop item on a travel day reads its own city's weather, not both", () => {
    const { ctx, ids } = locatedCtx();
    const ryokan: ItemScope = { kind: "stop", activityId: ids.s3, dayIndex: 1 };
    expect(renderMacro(ctx, "day.weather", {}, ryokan)).toMatchObject({
      status: "ok", rendered: { block: { rows: [{ city: "Kyoto" }] } },
    });
  });

  it("a stop item reads that one stop, and its day", () => {
    const { ctx, ids } = ctxOf();
    const ryokan: ItemScope = { kind: "stop", activityId: ids.s3, dayIndex: 1 };
    expect(renderMacro(ctx, "field", { field: "stop.title" }, ryokan)).toEqual({
      status: "ok",
      rendered: { kind: "inline", segs: [{ kind: "chip", name: "value", text: "Ryokan" }] },
    });
    expect(renderMacro(ctx, "count", {}, ryokan)).toMatchObject({
      rendered: { segs: [{ text: "1 stop" }] },
    });
    expect(renderMacro(ctx, "dates", {}, ryokan)).toEqual(renderMacro(ctx, "dates", { day: { kind: "index", index: 1 } }));
    // Its own city, not both of its travel day's.
    expect(renderMacro(ctx, "city", {}, ryokan)).toMatchObject({ rendered: { segs: [{ text: "Kyoto" }] } });
  });

  it("an unscheduled stop is on no day: its date is empty, never the trip's range", () => {
    const { ctx, ids } = ctxOf();
    const backlog: ItemScope = { kind: "stop", activityId: ids.b0, dayIndex: null };
    expect(renderMacro(ctx, "dates", {}, backlog)).toEqual({ status: "empty" });
    expect(renderMacro(ctx, "field", { field: "stop.title" }, backlog)).toMatchObject({
      rendered: { segs: [{ text: "Souvenirs" }] },
    });
  });
});

describe("insertRepeat — the one door a repeat enters a document by", () => {
  it("builds the stored node: the rows primitive's name, its filters, and its sentence", () => {
    expect(insertRepeat("day.rows", { dates: { from: "2027-06-01", through: "2027-06-02" }, template: "Day {date}" })).toEqual({
      ok: true,
      node: {
        type: "repeat",
        attrs: { name: "day.rows", params: { dates: { from: "2027-06-01", through: "2027-06-02" }, template: "Day {date}" } },
        content: [],
      },
    });
  });

  it("refuses what the rows primitive refuses, a table's columns, and a sentence that is not one line of 500", () => {
    expect(insertRepeat("cost", {})).toMatchObject({ ok: false, error: { reason: "unknown-widget" } });
    expect(insertRepeat("day.rows", { kind: "pending" })).toMatchObject({ ok: false, error: { reason: "bad-params" } });
    expect(insertRepeat("stop.rows", { columns: ["stop.cost"] })).toMatchObject({
      ok: false,
      error: { reason: "bad-params" },
    });
    expect(insertRepeat("city.rows", { template: "x".repeat(SENTENCE_TEMPLATE_MAX) }).ok).toBe(true);
    for (const template of ["x".repeat(SENTENCE_TEMPLATE_MAX + 1), "two\nlines", 42]) {
      expect(insertRepeat("city.rows", { template }), String(template).slice(0, 12)).toMatchObject({
        ok: false,
        error: { reason: "bad-params" },
      });
    }
  });

  it("a stored sentence it would refuse reads as invalid, not as a guess", () => {
    const { ctx } = ctxOf();
    expect(resolveRepeat(ctx, "city.rows", { template: "a\nb" })).toMatchObject({ status: "invalid" });
  });
});

describe("rescopeRepeat — the collection picker", () => {
  it("carries the sentence and every filter the new collection takes, and drops the rest", () => {
    const june = { from: "2027-06-01", through: "2027-06-02" };
    const stop = { template: "Hi {name}", city: "Kyoto", kind: "pending", dates: june };
    expect(rescopeRepeat("city", stop)).toEqual({ template: "Hi {name}", city: "Kyoto", dates: june });
    expect(insertRepeat("city.rows", rescopeRepeat("city", stop)).ok).toBe(true);
    // The other way, nothing is lost that a stop takes.
    expect(rescopeRepeat("stop", { template: "x", city: "Kyoto" })).toEqual({ template: "x", city: "Kyoto" });
  });

  // Mitchell, #221 preview: *"Changing repeat pretty much will always break the
  // string templates since they have different names"*. A sentence whose every
  // detail the new collection has travels as written; one naming a detail it
  // lacks becomes that collection's starting sentence, never raw braces.
  it("keeps a sentence whose details the new collection has, word for word", () => {
    expect(rescopeRepeat("city", { template: "{activityCount} stops, {{wow}}" }).template).toBe("{activityCount} stops, {{wow}}");
    expect(rescopeRepeat("stop", { template: "Just words" }).template).toBe("Just words");
    expect(rescopeRepeat("stop", {})).toEqual({});
  });

  it("swaps a sentence naming a detail the new collection lacks for that collection's starting sentence", () => {
    expect(rescopeRepeat("city", { template: "{index}: {cities}" }).template).toBe(DEFAULT_SENTENCES.city);
    expect(rescopeRepeat("stop", { template: "Welcome to {name}" }).template).toBe(DEFAULT_SENTENCES.stop);
    expect(rescopeRepeat("day", { template: "{title} costs {cost}" }).template).toBe(DEFAULT_SENTENCES.day);
  });

  it("never leaves a token the new collection cannot print, from any collection to any other", () => {
    const templates = [...Object.values(DEFAULT_SENTENCES), ...REPEAT_SCOPE_ORDER.flatMap((from) => sentenceFields(from).map((f) => `a {${f.key}} b`))];
    let checked = 0;
    for (const to of REPEAT_SCOPE_ORDER) {
      // Each starting sentence fits its own collection, and prints no raw token.
      expect(printsEveryToken(to, DEFAULT_SENTENCES[to]), `${to}'s starting sentence`).toBe(true);
      for (const template of templates) {
        checked += 1;
        const next = rescopeRepeat(to, { template }).template as string;
        expect(printsEveryToken(to, next), `"${template}" → ${to} became "${next}"`).toBe(true);
        expect(insertRepeat(REPEAT_WIDGETS[to], { template: next }).ok).toBe(true);
      }
    }
    expect(checked).toBeGreaterThan(20);
  });
});

// Mitchell, #221 preview: *"can we do the same for 'A line for every....'?"* —
// the table's "Lines for each" picker moves `day.rows` / `stop.rows` /
// `city.rows` between collections through `rescopeRows`, which keeps the params
// the new primitive takes. A table has columns, so unlike a sentence it keeps
// `columns` — onto `stop.rows`, the one primitive that takes them.
describe("rescopeRows — the table's collection picker", () => {
  const june = { from: "2027-06-01", through: "2027-06-02" };
  // Every param a rows primitive takes, set: the widest starting point, so a
  // key the picker should drop is always there to be dropped.
  const EVERYTHING: Record<RepeatOver, Record<string, unknown>> = {
    day: { day: { kind: "index", index: 0 }, city: "Kyoto", dates: june },
    stop: { day: { kind: "index", index: 0 }, city: "Kyoto", tag: "meal", kind: "pending", dates: june, only: "needsBooking", columns: ["stop.cost"] },
    city: { city: "Kyoto", dates: june },
  };

  it("keeps what the new collection takes and drops the rest — columns only onto stops", () => {
    expect(rescopeRows("city", EVERYTHING.stop)).toEqual({ city: "Kyoto", dates: june });
    expect(rescopeRows("day", EVERYTHING.stop)).toEqual({ day: { kind: "index", index: 0 }, city: "Kyoto", dates: june });
    expect(rescopeRows("stop", { columns: ["stop.cost"], city: "Kyoto" })).toEqual({ columns: ["stop.cost"], city: "Kyoto" });
    expect(rescopeRows("day", { columns: ["stop.cost"] })).toEqual({});
  });

  it("always leaves params the new primitive accepts and keeps, from any collection to any other", () => {
    let checked = 0;
    for (const from of REPEAT_SCOPE_ORDER) {
      // The starting point is itself valid, or the sweep proves nothing.
      expect(insertWidget(REPEAT_WIDGETS[from], EVERYTHING[from]).ok, `${from}'s full params`).toBe(true);
      for (const to of REPEAT_SCOPE_ORDER) {
        const next = rescopeRows(to, EVERYTHING[from]);
        const inserted = insertWidget(REPEAT_WIDGETS[to], next);
        expect(inserted.ok, `${from} → ${to}: ${JSON.stringify(next)}`).toBe(true);
        // Nothing the target takes was lost on the way: the node carries every key.
        expect(inserted.ok && inserted.node.attrs.params).toEqual(next);
        checked += 1;
      }
    }
    expect(checked).toBe(9);
  });
});

// Review of #221: what the settings panel names under the sentence, so the
// author sees why a line shows a gap rather than a value.
describe("unknownSentenceTokens — what the settings panel warns about", () => {
  it("names each token the collection does not publish, once, in the order written", () => {
    expect(unknownSentenceTokens("stop", "{nme} at {title}, {cities} and {nme} again")).toEqual(["nme", "cities"]);
    expect(unknownSentenceTokens("day", "{index}: {cities}")).toEqual([]);
  });

  it("reads only tokens: a malformed brace or an escape is prose, not an unknown detail", () => {
    expect(unknownSentenceTokens("city", "{ nme } {} {{nme}} {nme")).toEqual([]);
  });
});

// Every token in `template` is a detail `over` publishes.
const printsEveryToken = (over: RepeatOver, template: string) =>
  parseSentenceTemplate(template).every((part) => "text" in part || sentenceFieldAt(over, part.field) !== undefined);

describe("findWidgetError inside a repeat (KI-2026-09-24-d item 3)", () => {
  const repeat = (name: string, params: Record<string, unknown>, content: unknown[] = []) => ({
    type: "repeat",
    attrs: { name, params },
    content,
  });

  it("passes a repeat over a collection with a sentence", () => {
    expect(findWidgetError([repeat("day.rows", { template: "Day {date} in {cities}" })])).toBeNull();
    expect(findWidgetError([repeat("stop.rows", { kind: "pending", only: "needsBooking", template: "{title}" })])).toBeNull();
  });

  it.each([
    ["a repeat over nothing it can repeat", repeat("cost", {}), /Unknown repeat "cost"/],
    ["a repeat filter its collection does not take", repeat("day.rows", { kind: "pending" }), /day\.rows does not accept kind/],
    ["a repeat carrying table columns", repeat("stop.rows", { columns: ["stop.cost"] }), /columns/],
    ["a malformed repeat", { type: "repeat", attrs: { name: "" }, content: [] }, /Invalid repeat node/],
    ["a sentence over the limit", repeat("day.rows", { template: "x".repeat(501) }), /sentence/],
    // A v2 template nobody migrated: the editor holds a repeat as a leaf.
    ["a repeat still carrying content", repeat("day.rows", {}, [{ type: "text", text: "Day " }]), /carries content/],
  ])("refuses %s", (_label, node, message) => {
    expect(findWidgetError([{ type: "blockquote", content: [node] }])).toMatch(message);
  });
});

describe("the repeat preset — how a person reaches one", () => {
  it("is ONE row, which inserts an unwritten sentence over days", () => {
    expect(PRESETS.filter((preset) => preset.repeat).map((preset) => preset.id)).toEqual(["sentence"]);
    expect(insertPreset("sentence")).toEqual({ ok: true, node: { type: "repeat", attrs: { name: "day.rows", params: {} }, content: [] } });
  });

  it("asks nothing at insert — the collection and the sentence are chosen in its settings", () => {
    expect(presetCatalog().find((entry) => entry.name === "sentence")!.inputs).toEqual([]);
  });

  it("answers to no retired widget name — those were widgets, not sentences", () => {
    expect(presetCatalog().find((entry) => entry.name === "sentence")!.aliases).toEqual([]);
    expect([...presetCatalog().find((entry) => entry.name === "line")!.aliases].sort()).toEqual(["city.line", "day.line", "stop.line"]);
  });
});
