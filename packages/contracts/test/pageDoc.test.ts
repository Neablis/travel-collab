import { describe, expect, it } from "vitest";
import { PageWidgetNode } from "../src/pageDoc";

// M58 decision 5: `hideWhenPublic` is optional on a widget instance, so every
// page stored before it still parses, and the flag survives a parse.
describe("PageWidgetNode hideWhenPublic", () => {
  const node = (attrs: Record<string, unknown>) => ({ type: "macro", attrs: { name: "cost", params: {}, ...attrs } });

  it("parses a stored widget that has no flag, leaving it unset", () => {
    const parsed = PageWidgetNode.parse(node({}));
    expect(parsed.attrs.hideWhenPublic).toBeUndefined();
  });

  it("keeps the flag when it is set", () => {
    expect(PageWidgetNode.parse(node({ hideWhenPublic: true })).attrs.hideWhenPublic).toBe(true);
  });

  it("refuses a flag that is not a boolean", () => {
    expect(PageWidgetNode.safeParse(node({ hideWhenPublic: "yes" })).success).toBe(false);
  });
});
