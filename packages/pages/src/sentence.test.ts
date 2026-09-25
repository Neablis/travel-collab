import { describe, expect, it } from "vitest";
import { REPEAT_SCOPE_ORDER, parseSentenceTemplate, v2WidgetToken } from "@tc/contracts";
import type { WidgetContext } from "./registry-types";
import { MACRO_NAMES } from "./registry";
import { fieldChoices } from "./fields";
import { formatKind } from "./kinds";
import { resolveRepeat } from "./repeat";
import { SENTENCE_NO_VALUE, sentenceFieldAt, sentenceFields, sentenceLine, sentenceLines } from "./sentence";
import { selectionTrip } from "./test-support/selectionTrip";

// A repeat's sentence (PR #221 preview, 2026-09-24): `{key}` tokens read off
// each line's item. What is pinned here is what a line PRINTS — the grammar's
// own claims for every string are `sentence.property.test.ts`.

function ctxOf() {
  const { trip, globals, ids } = selectionTrip();
  const ctx: WidgetContext = { trip, globals, page: { tripId: trip.tripId }, user: null, today: null };
  return { ctx, ids };
}

// The same trip with one stop renamed. Titles enter no rollup, so this touches
// nothing `selectionTrip` promises about costs.
function withTitle(ctx: WidgetContext, id: string, title: string): WidgetContext {
  const trip = ctx.trip!;
  return { ...ctx, trip: { ...trip, activities: { ...trip.activities, [id]: { ...trip.activities[id]!, title } } } };
}

const linesOf = (ctx: WidgetContext, name: string, template: string, params: Record<string, unknown> = {}) => {
  const outcome = resolveRepeat(ctx, name, params);
  if (outcome.status !== "ok") throw new Error(`expected items, got ${JSON.stringify(outcome)}`);
  return sentenceLines(ctx, outcome.over, outcome.items, template);
};

describe("sentenceFields — what a sentence can name", () => {
  it("is the item's own manifest fields, keyed by field name", () => {
    expect(sentenceFields("city").map((f) => f.key)).toEqual(["name", "dayIndexes", "activityCount"]);
    expect(sentenceFields("stop").map((f) => f.key)).toEqual(fieldChoices("stop").map((c) => c.path.slice("stop.".length)));
    expect(sentenceFields("day").map((f) => f.key)).toEqual(
      expect.arrayContaining(["index", "date", "cities", "activityCount", "costSubtotal"]),
    );
    // Every key is a token the grammar reads as a token.
    for (const over of REPEAT_SCOPE_ORDER) {
      for (const { key } of sentenceFields(over)) expect(parseSentenceTemplate(`{${key}}`)).toEqual([{ field: key }]);
    }
  });

  it("knows every token the v2 → v3 migration writes, so a converted sentence never prints its own token", () => {
    const candidates = [
      ...MACRO_NAMES.map((name) => ({ name, params: {} })),
      ...fieldChoices("stop").map((c) => ({ name: "field", params: { field: c.path } })),
    ];
    let tokens = 0;
    for (const over of REPEAT_SCOPE_ORDER) {
      for (const attrs of candidates) {
        const token = v2WidgetToken(over, attrs);
        if (token === null) continue;
        tokens += 1;
        expect(sentenceFieldAt(over, token), `${over} {${token}} from ${attrs.name}`).toBeDefined();
      }
    }
    // Measured: 1 city + 3 day + 7 stop (six fields and `cost{}`).
    expect(tokens).toBe(11);
  });
});

describe("sentenceLine — one line per item", () => {
  it("prints each line from its own day, stop or city", () => {
    const { ctx } = ctxOf();
    expect(linesOf(ctx, "city.rows", "Welcome to {name}!")).toEqual(["Welcome to Rome!", "Welcome to Kyoto!"]);
    const date = (iso: string) => formatKind("date", iso, { currency: "USD" });
    // Day 3 has no date: a visible gap, not a sentence that closes up around it.
    expect(linesOf(ctx, "day.rows", "On {date}")).toEqual([`On ${date("2027-06-01")}`, `On ${date("2027-06-02")}`, `On ${SENTENCE_NO_VALUE}`]);
    expect(linesOf(ctx, "stop.rows", "{title} ({kind})", { kind: "pending" })).toHaveLength(2);
  });

  // #221 preview: the "Trip day" detail printed "0" on the first day, because
  // the stored index counts from 0. A trip day prints as a reader counts.
  it("prints a trip day counting from 1, alone and in a city's list of days", () => {
    const { ctx } = ctxOf();
    expect(linesOf(ctx, "day.rows", "{index}")).toEqual(["Day 1", "Day 2", "Day 3"]);
    expect(linesOf(ctx, "city.rows", "{name}: {dayIndexes}")).toEqual(["Rome: Day 1, Day 2", "Kyoto: Day 2"]);
  });

  it("prints a malformed brace and an escape as the author wrote them", () => {
    const { ctx } = ctxOf();
    expect(linesOf(ctx, "city.rows", "{ name } {} {{name}} }}{{ {name")[0]).toBe("{ name } {} {name} }{ {name");
    expect(linesOf(ctx, "city.rows", "}}{{")).toEqual(["}{", "}{"]);
  });

  // Review of #221: a token the collection does not publish used to print as
  // written, putting raw template syntax on the page. It is a gap instead, the
  // same one a missing value leaves; the settings panel names it to the author.
  it("prints a token this collection does not publish as a gap, never as braces", () => {
    const { ctx } = ctxOf();
    // A typo, and a key another collection publishes (`title` is a stop's).
    expect(linesOf(ctx, "city.rows", "{nme} in {name}, {title}")).toEqual([
      `${SENTENCE_NO_VALUE} in Rome, ${SENTENCE_NO_VALUE}`,
      `${SENTENCE_NO_VALUE} in Kyoto, ${SENTENCE_NO_VALUE}`,
    ]);
    expect(linesOf(ctx, "stop.rows", "{cities}", { kind: "pending" })).toEqual([SENTENCE_NO_VALUE, SENTENCE_NO_VALUE]);
  });

  it("prints a template of only tokens as the values alone", () => {
    const { ctx } = ctxOf();
    expect(linesOf(ctx, "city.rows", "{name}{activityCount}")[0]).toMatch(/^Rome\d+$/);
  });

  it("has nothing to read without the projection, and says so per field rather than failing", () => {
    const { ctx } = ctxOf();
    const outcome = resolveRepeat(ctx, "day.rows", {});
    if (outcome.status !== "ok") throw new Error("expected days");
    expect(sentenceLine({ ...ctx, globals: null }, "day", outcome.items[0]!, parseSentenceTemplate("Day {date}"))).toBe(
      `Day ${SENTENCE_NO_VALUE}`,
    );
  });

  // Hostile names: every one prints as exactly the characters it is. The line
  // is a string React renders as text (`RepeatNodeView.test.tsx` holds the DOM
  // half); the claim here is that nothing between the value and the line reads
  // it as a template.
  it.each([
    ["markup", "<img src=x onerror=alert(1)>"],
    ["a token of this collection", "{title}"],
    ["a token of another collection", "{city}"],
    ["a shell-style token", "${city}"],
    ["escaped braces", "}}{{"],
    ["a token that is a stop field with a value", "{cost}"],
    ["ten thousand characters", "x".repeat(10_000)],
  ])("a stop named with %s prints its name, never re-read as a template", (_label, title) => {
    const { ctx, ids } = ctxOf();
    const lines = linesOf(withTitle(ctx, ids.s0, title), "stop.rows", "«{title}»", { kind: "pending" });
    expect(lines[0]).toBe(`«${title}»`);
  });

  it("a value that spells another token beside that token prints both, each once", () => {
    const { ctx, ids } = ctxOf();
    const [line] = linesOf(withTitle(ctx, ids.s0, "{cost}"), "stop.rows", "{title} / {cost}", { kind: "pending" });
    expect(line!.startsWith("{cost} / ")).toBe(true);
    expect(line!.slice("{cost} / ".length)).not.toContain("{");
  });
});
