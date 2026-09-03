import { describe, expect, it } from "vitest";
import { MacroNode, PageContext, Page, CreatePageInput } from "../src";

describe("page contracts", () => {
  it("accepts a valid inline macro node", () => {
    const node = { type: "macro", attrs: { name: "cost.trip", params: {} } };
    expect(MacroNode.parse(node).attrs.name).toBe("cost.trip");
  });

  it("accepts a block macro node carrying a day param", () => {
    const node = { type: "macro", attrs: { name: "itinerary.day", params: { day: { kind: "index", index: 2 } } } };
    expect(MacroNode.parse(node).attrs.params).toEqual({ day: { kind: "index", index: 2 } });
  });

  it("binds a page to a trip and to nothing else", () => {
    const tripId = crypto.randomUUID();
    expect(PageContext.parse({ tripId })).toEqual({ tripId });
  });

  // A page row written before SPEC §18 carries `dayRef` in its `context` jsonb.
  // `PageContext` is a plain (non-strict) object, so those rows still parse and
  // the dead key is dropped on the way through — which is why removing the
  // field needs no migration and no backfill.
  it("drops a pre-§18 page's day binding instead of rejecting the row", () => {
    const tripId = crypto.randomUUID();
    expect(PageContext.parse({ tripId, dayRef: { kind: "index", index: 0 } })).toEqual({ tripId });
  });

  it("validates a full Page row", () => {
    const page = {
      id: crypto.randomUUID(), tripId: crypto.randomUUID(), title: "Overview",
      context: { tripId: crypto.randomUUID() },
      content: { type: "doc", content: [] },
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), actorId: "user-1",
    };
    expect(Page.parse(page).title).toBe("Overview");
  });

  it("CreatePageInput requires title + context, not id/timestamps", () => {
    const ok = CreatePageInput.safeParse({ title: "X", context: { tripId: crypto.randomUUID() }, content: { type: "doc", content: [] } });
    expect(ok.success).toBe(true);
  });
});
