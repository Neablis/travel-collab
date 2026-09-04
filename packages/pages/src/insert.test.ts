import { describe, expect, it } from "vitest";
import { insertWidget } from "./insert";
import { MACRO_NAMES, getMacro } from "./registry";

describe("insertWidget", () => {
  it("builds a stored `macro` node for a widget that binds nothing", () => {
    const result = insertWidget("trip.name");
    expect(result).toEqual({ ok: true, node: { type: "macro", attrs: { name: "trip.name", params: {} } } });
  });

  it("carries a binding through into the node's params", () => {
    const result = insertWidget("cost.day", { dayRef: { kind: "index", index: 2 } });
    expect(result.ok && result.node.attrs.params).toEqual({ dayRef: { kind: "index", index: 2 } });
  });

  it("inserts a day widget UNBOUND when nothing is chosen, rather than guessing a day", () => {
    // ADR-037 decision 4: with no modal step, "Point it at" has nowhere to live
    // at insert time — you insert, then point it. Decision 6 is what makes that
    // safe: a widget bound to nothing renders "not set up" rather than
    // defaulting to day 1, which would be a confident wrong answer.
    const result = insertWidget("cost.day");
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
    // into a document that skips validation. `dayRef` must be a DayRef, and a
    // string is not one.
    const result = insertWidget("cost.day", { dayRef: "day 2" });
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
