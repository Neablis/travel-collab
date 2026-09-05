import { describe, expect, it } from "vitest";
import { insertWidget } from "./insert";
import { MACRO_NAMES, getMacro } from "./registry";

describe("insertWidget", () => {
  it("builds a stored `macro` node for a widget that binds nothing", () => {
    const result = insertWidget("count");
    expect(result).toEqual({ ok: true, node: { type: "macro", attrs: { name: "count", params: {} } } });
  });

  it("carries a binding through into the node's params", () => {
    const result = insertWidget("cost", { day: { kind: "index", index: 2 } });
    expect(result.ok && result.node.attrs.params).toEqual({ day: { kind: "index", index: 2 } });
  });

  it("inserts a filtered widget WIDE when nothing is chosen, rather than guessing a day", () => {
    // ADR-037 decision 4: with no modal step, "Point it at" has nowhere to live
    // at insert time — you insert, then point it. ADR-039 decision 2 is what
    // makes that useful rather than merely safe: an absent filter is not a
    // widget waiting for a choice, it is the widest true answer, so a `cost`
    // that lands with `{}` shows the trip's total immediately.
    const result = insertWidget("cost");
    expect(result.ok && result.node.attrs.params).toEqual({});
  });

  it("refuses an unknown widget with a typed reason rather than throwing", () => {
    expect(insertWidget("nope.nope")).toEqual({
      ok: false,
      error: { reason: "unknown-widget", name: "nope.nope" },
    });
  });

  it("refuses params the widget's own schema rejects", () => {
    // The invariant this command exists for: there is no way to put a widget
    // into a document that skips validation. `day` must be a DayRef, and a
    // string is not one.
    const result = insertWidget("cost", { day: "day 2" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.reason).toBe("bad-params");
  });

  it("can insert every registered widget with no arguments", () => {
    // Registry-wide, so a widget added later is covered the day it lands: the
    // sidebar offers everything in the registry, and a widget whose schema
    // cannot parse `{}` would be listed and un-insertable.
    for (const name of MACRO_NAMES) {
      const result = insertWidget(name);
      expect(result.ok, `${name} cannot be inserted unbound`).toBe(true);
    }
    expect(MACRO_NAMES.length).toBeGreaterThan(0);
  });

  it("produces a node whose resolver can read it back", () => {
    // The round trip that matters: what insert writes, resolve reads. A node
    // this command produced must never be one `resolveMacro` calls bad-params.
    for (const name of MACRO_NAMES) {
      const result = insertWidget(name);
      if (!result.ok) throw new Error(`${name} did not insert`);
      const def = getMacro(name)!;
      expect(def.params.safeParse(result.node.attrs.params).success, `${name} round trip`).toBe(true);
    }
  });
});
