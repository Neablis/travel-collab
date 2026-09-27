import { describe, expect, it } from "vitest";
import { COMPOSABLE_MACRO_NAMES, getMacro } from "./registry";
import { insertWidget } from "./insert";
import { WIDGET_SEARCH_MAX_LIMIT, searchWidgets, widgetDetail, widgetIndex } from "./widgetSearch";

// The assistant's widget search (ADR-057). What is pinned here is what a model
// relies on when it no longer sees the catalogue: that the words a person uses
// find the widget they mean, that every widget can be found at all, and that
// the example a match carries is one `insert_widget` will take.

const ids = (query: string, filters = {}) => searchWidgets(query, filters).matches.map((m) => m.id);

describe("searchWidgets ranking", () => {
  it("puts the preset whose words the query uses first, whatever the sentence around them", () => {
    // "spend", "chart" and "money" are on every spend preset; "tag" decides.
    expect(ids("spend by tag chart")[0]).toBe("spend-by-tag");
    expect(ids("add a spend by tag chart to Money")[0]).toBe("spend-by-tag");
    expect(ids("spend by kind")[0]).toBe("spend-by-kind");
    expect(ids("budget burn down")[0]).toBe("budget-burn-down");
    expect(ids("how many days")[0]).toBe("count.days");
    expect(ids("countdown")[0]).toBe("trip.countdown");
  });

  it("finds a retired widget name through the preset it became", () => {
    expect(ids("booking.line")).toContain("still-to-book");
  });

  it("answers the same list to the same query, and drops rows that match no word", () => {
    expect(searchWidgets("weather forecast")).toEqual(searchWidgets("weather forecast"));
    expect(searchWidgets("zzzz qqqq").matches).toEqual([]);
  });

  it("lists the filtered index in order for an empty query, capped by the limit", () => {
    const all = searchWidgets("", {}, WIDGET_SEARCH_MAX_LIMIT);
    expect(all.total).toBe(widgetIndex().length);
    expect(all.matches.map((m) => m.id)).toEqual(widgetIndex().slice(0, WIDGET_SEARCH_MAX_LIMIT).map((r) => r.id));
  });

  it("filters by shape, by entity and by a filter the widget still accepts as inserted", () => {
    expect(searchWidgets("", { shape: "repeat" }, WIDGET_SEARCH_MAX_LIMIT).matches.every((m) => m.shape === "repeat")).toBe(true);
    expect(searchWidgets("", { entity: "city" }, WIDGET_SEARCH_MAX_LIMIT).matches.every((m) => m.selects?.entity === "city")).toBe(true);
    // "Spend by tag" withholds the tag filter (its slices ARE the tags), so a
    // search for widgets that take a tag must not offer it; "Spend by kind" does.
    const takingTag = ids("spend", { acceptsFilter: "tag" });
    expect(takingTag).toContain("spend-by-kind");
    expect(takingTag).not.toContain("spend-by-tag");
  });
});

describe("a match", () => {
  it("carries the example to insert, the filters it takes, the withheld rule and the choice options", () => {
    const match = searchWidgets("spend by tag").matches[0]!;
    expect(match.insert).toEqual({ name: "cost.breakdown", params: { by: "tag" } });
    expect(match.selects).toEqual({ entity: "stop", filters: ["day", "dates", "city", "kind"] });
    expect(match.withheld).toEqual(getMacro("cost.breakdown")!.selection!.withheld);
    expect(match.params).toEqual({ by: ["kind", "tag"] });
  });

  // The example is what a model copies. An example `insertWidget` refuses is a
  // row that teaches the model to fail — except an address, whose placeholder
  // is refused on purpose so that no link is planted from an example.
  it("inserts as it stands for every row, and an address placeholder never does", () => {
    for (const row of widgetIndex()) {
      const { insert } = searchWidgets(row.id, {}, WIDGET_SEARCH_MAX_LIMIT).matches.find((m) => m.id === row.id)!;
      const takesAddress = getMacro(insert.name)!.inputs.some((input) => input.type === "url");
      expect(insertWidget(insert.name, insert.params).ok, `${row.id}: ${JSON.stringify(insert)}`).toBe(!takesAddress);
    }
  });

  it("points at get_widget for field paths and link targets, and get_widget has them", () => {
    const field = searchWidgets("a stop's detail").matches.find((m) => m.insert.name === "field")!;
    expect(field.detail).toContain("field paths");
    expect(field.params?.field).toBeNull();
    expect(widgetDetail(field.id)!.fields!.field!.length).toBeGreaterThan(3);
    expect(searchWidgets("link to a notebook").matches[0]!.detail).toContain("notebooks");
  });
});

describe("findability", () => {
  // Mitchell's condition for dropping the catalogue from the prompt: the
  // assistant "can still create and make changes in a notebook". A widget no
  // query finds is one the assistant can no longer insert, so every one is
  // looked for by the title a person sees on it.
  it("finds every widget the assistant may insert by its own title", () => {
    expect(COMPOSABLE_MACRO_NAMES.length).toBeGreaterThan(20);
    for (const name of COMPOSABLE_MACRO_NAMES) {
      const title = getMacro(name)!.title;
      const top = searchWidgets(title).matches.slice(0, 3).map((m) => m.insert.name);
      expect(top, `"${title}" (${name})`).toContain(name);
    }
  });

  it("finds every row of the index first by its own title", () => {
    for (const row of widgetIndex()) {
      expect(searchWidgets(row.title).matches[0]?.insert.name, `"${row.title}" (${row.id})`).toBe(row.widget);
    }
  });

  it("includes both link widgets, which the assistant may now insert", () => {
    expect(widgetIndex().map((row) => row.widget)).toEqual(expect.arrayContaining(["link.internal", "link.external"]));
  });
});
