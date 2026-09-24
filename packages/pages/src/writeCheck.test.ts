import { describe, expect, it } from "vitest";
import { DEFAULT_TEMPLATES, TEMPLATE_LIBRARY } from "./templates";
import { findWidgetError } from "./writeCheck";

const macro = (name: string, params: Record<string, unknown> = {}) => ({ type: "macro", attrs: { name, params } });
const inPara = (...content: unknown[]) => ({ type: "paragraph", content });

describe("findWidgetError", () => {
  it("passes a document whose widgets are all registered with legal params", () => {
    expect(findWidgetError([inPara(macro("attribute", { field: "trip.name" })), inPara(macro("cost", { kind: "booked" }))])).toBeNull();
  });

  it.each([
    ["an unregistered name", macro("nope.nope"), /Unknown macro "nope\.nope"/],
    ["a field outside attribute's allow-list", macro("attribute", { field: "account.email" }), /Macro "attribute" params failed/],
    ["a filter the widget does not select by", macro("city.rows", { kind: "booked" }), /city\.rows does not accept kind/],
    ["a malformed macro node", { type: "macro", attrs: { name: "" } }, /Invalid macro node/],
  ])("refuses %s, however deeply it is nested", (_label, node, message) => {
    const nested = [{ type: "bulletList", content: [{ type: "listItem", content: [inPara(node)] }] }];
    expect(findWidgetError(nested)).toMatch(message);
  });

  it("carries a node from a newer build rather than judging it", () => {
    expect(findWidgetError([{ type: "unknown", raw: { type: "futureNode", attrs: { name: "nope" } } }])).toBeNull();
  });

  // The server refuses on this now, so a shipped template it refused would be
  // a page the app offers and cannot save.
  it.each([...DEFAULT_TEMPLATES, ...TEMPLATE_LIBRARY].map((t) => [t.key, t] as const))(
    "passes the shipped template %s",
    (_key, template) => {
      expect(findWidgetError(template.content.content)).toBeNull();
    },
  );
});
