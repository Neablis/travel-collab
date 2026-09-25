import { describe, expect, it } from "vitest";
import { CURRENT_PAGE_DOC_VERSION, parsePageDoc } from "@tc/contracts";
import { DEFAULT_TEMPLATES, TEMPLATE_LIBRARY } from "./templates";
import { findWidgetError } from "./writeCheck";
import { renderMacro } from "./registry";
import type { WidgetContext } from "./registry-types";
import { selectionTrip } from "./test-support/selectionTrip";

const macro = (name: string, params: Record<string, unknown> = {}) => ({ type: "macro", attrs: { name, params } });
const inPara = (...content: unknown[]) => ({ type: "paragraph", content });

describe("findWidgetError", () => {
  it("passes a document whose widgets are all registered with legal params", () => {
    expect(findWidgetError([inPara(macro("attribute", { field: "trip.name" })), inPara(macro("cost", { kind: "pending" }))])).toBeNull();
  });

  it.each([
    ["an unregistered name", macro("nope.nope"), /Unknown macro "nope\.nope"/],
    ["a field outside attribute's allow-list", macro("attribute", { field: "account.email" }), /Macro "attribute" params failed/],
    ["a filter the widget does not select by", macro("city.rows", { kind: "pending" }), /city\.rows does not accept kind/],
    ["a malformed macro node", { type: "macro", attrs: { name: "" } }, /Invalid macro node/],
  ])("refuses %s, however deeply it is nested", (_label, node, message) => {
    const nested = [{ type: "bulletList", content: [{ type: "listItem", content: [inPara(node)] }] }];
    expect(findWidgetError(nested)).toMatch(message);
  });

  it("still saves and renders a page stored while `person` was a filter", () => {
    // Mitchell, 2026-09-24: *"person is removed for now"* — `cost`, `count` and
    // `stop.rows` stopped declaring it. A page written before that carries
    // `person` in its params, and refusing it here would lock the WHOLE page
    // against every later prose edit (the brainstorm's field-widget gap 1).
    // Nothing in this build can honour the dimension, so it strips on the
    // write path the way it always did on the read path.
    const stored = parsePageDoc({
      v: CURRENT_PAGE_DOC_VERSION,
      type: "doc",
      content: [
        inPara(macro("cost", { person: "dev-alice" })),
        inPara(macro("count", { person: "dev-alice", kind: "pending" })),
        inPara(macro("stop.rows", { person: "dev-alice", only: "needsBooking" })),
      ],
    });
    expect(findWidgetError(stored.content)).toBeNull();

    const { trip, globals } = selectionTrip();
    const ctx: WidgetContext = { trip, page: { tripId: trip.tripId }, user: null, globals, today: null };
    // Rendered as the widget without the stale filter — the same answer as
    // params that never had it, not a "needs a person" chip nothing can fill.
    for (const [name, params] of [
      ["cost", {}],
      ["count", { kind: "pending" }],
      ["stop.rows", { only: "needsBooking" }],
    ] as const) {
      const withPerson = renderMacro(ctx, name, { ...params, person: "dev-alice" });
      expect(withPerson.status, `${name} with a stored person`).toBe("ok");
      expect(withPerson, `${name} with a stored person`).toEqual(renderMacro(ctx, name, params));
    }
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
