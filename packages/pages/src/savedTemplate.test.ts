import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CURRENT_PAGE_DOC_VERSION, serializePageDoc, type PageDoc } from "@tc/contracts";
import { tripDetailFactory } from "@tc/factories";
import { UNRESOLVED_DAY_ID, instantiateTemplate } from "./savedTemplate";
import { getMacro, renderMacro } from "./registry";
import { findWidgetError } from "./writeCheck";
import type { WidgetContext } from "./registry-types";
import { witness } from "./test-support/witness";

type Walked = { type?: string; attrs?: { name?: string; params?: Record<string, unknown> }; raw?: unknown };

/** Every node in a document, depth-first — but not inside an `unknown` node's `raw`. */
function walk(node: unknown, out: Walked[] = []): Walked[] {
  if (typeof node !== "object" || node === null) return out;
  const n = node as Walked & { content?: unknown[] };
  if (typeof n.type === "string") out.push(n);
  if (n.type === "unknown") return out;
  for (const child of n.content ?? []) walk(child, out);
  return out;
}
const widgetsIn = (doc: unknown) => walk(doc).filter((n) => n.type === "macro" || n.type === "repeat");

const TARGET = tripDetailFactory.build({ startDate: "2027-05-01" }, { transient: { dayCount: 3, activitiesPerDay: 1 } });
const target = { tripId: TARGET.tripId, dayIds: TARGET.days.map((d) => d.dayId) };
const SOURCE_DAY = "5a0e0000-0000-4000-8000-00000000d001";

const ctx: WidgetContext = { trip: TARGET, page: { tripId: TARGET.tripId }, user: null, globals: null, today: null };

// **A template saved before the widget vocabulary moved, pinned as it was
// stored** — gate box 2 of M14 (*"a template snapshotted at one document
// version still instantiates after the AST has moved"*). v1 is the version
// before ADR-039 collapsed seventeen widget names into eleven primitives; these
// are v1 names and v1 param keys (`dayRef`), and no `v`, exactly as a v1 row
// is stored. FROZEN: this literal is what makes the claim about an OLDER
// version rather than about whatever the current one is.
const SNAPSHOT_V1: unknown = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Kyoto" }] },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Day one costs " },
        { type: "macro", attrs: { name: "cost.day", params: { dayRef: { kind: "index", index: 0 } } } },
      ],
    },
    { type: "macro", attrs: { name: "itinerary.day", params: { dayRef: { kind: "index", index: 1 } } } },
    { type: "macro", attrs: { name: "booking.line", params: {} } },
    {
      type: "repeat",
      attrs: { name: "day.line", params: {} },
      content: [{ type: "text", text: "· " }],
    },
  ],
};

describe("instantiateTemplate — an older snapshot after the AST has moved", () => {
  it("migrates a v1 snapshot to the current version, and every widget renders in the new trip", () => {
    // The premise, asserted rather than assumed: if the chain were empty there
    // would be nothing to migrate, and this test would pass by standing still.
    expect(CURRENT_PAGE_DOC_VERSION).toBeGreaterThan(1);

    const made = instantiateTemplate(SNAPSHOT_V1, target);
    if (!made.ok) throw new Error(made.message);
    expect(made.content.v).toBe(CURRENT_PAGE_DOC_VERSION);

    // What the server's write check would say — the command path refuses a
    // document that fails this, so this is "it would be created".
    expect(findWidgetError((serializePageDoc(made.content) as { content: unknown[] }).content)).toBeNull();

    const widgets = widgetsIn(made.content);
    expect(widgets.map((w) => w.attrs?.name)).toEqual(["cost", "day.detail", "stop.rows", "day.rows"]);
    // The binding survived the rename: `cost.day{dayRef: 0}` is `cost{day: 0}`.
    expect(widgets[0]!.attrs?.params).toEqual({ day: { kind: "index", index: 0 } });
    for (const w of widgets) {
      const name = w.attrs!.name!;
      expect(getMacro(name), name).toBeDefined();
      expect(["ok", "empty"], `${name} did not resolve`).toContain(renderMacro(ctx, name, w.attrs!.params).status);
    }
  });

  it("refuses a snapshot from a newer build rather than guessing at it", () => {
    const made = instantiateTemplate({ v: CURRENT_PAGE_DOC_VERSION + 1, type: "doc", content: [] }, target);
    expect(made).toMatchObject({ ok: false });
  });

  it("refuses a snapshot that is not a document", () => {
    expect(instantiateTemplate({ type: "not-a-doc" }, target)).toMatchObject({ ok: false });
  });
});

describe("instantiateTemplate — the day re-binding rule", () => {
  const doc = (content: unknown[]): PageDoc => ({ v: CURRENT_PAGE_DOC_VERSION, type: "doc", content }) as PageDoc;
  const cost = (day: unknown) => ({ type: "macro", attrs: { name: "cost", params: { day } } });

  it("re-points a day pinned by the source trip's id at no day, and it renders unbound", () => {
    const made = instantiateTemplate(doc([cost({ kind: "dayId", dayId: SOURCE_DAY })]), target);
    if (!made.ok) throw new Error(made.message);
    const [w] = widgetsIn(made.content);
    expect(w!.attrs?.params?.day).toEqual({ kind: "dayId", dayId: UNRESOLVED_DAY_ID });
    expect(JSON.stringify(made.content)).not.toContain(SOURCE_DAY);
    // The Editing ghost / Reading placeholder: MacroView's "that day was removed".
    expect(renderMacro(ctx, "cost", w!.attrs!.params)).toEqual({ status: "unbound", needs: "day", shape: expect.any(Array) });
  });

  it("keeps a day pinned by an id the target trip has — a template reused in its own trip", () => {
    const ref = { kind: "dayId", dayId: target.dayIds[2] };
    const made = instantiateTemplate(doc([cost(ref)]), target);
    if (!made.ok) throw new Error(made.message);
    expect(widgetsIn(made.content)[0]!.attrs?.params?.day).toEqual(ref);
  });

  // Positions are not ids: "Day 2" is Day 2 of whichever trip.
  it("carries a day by position as written", () => {
    const made = instantiateTemplate(doc([cost({ kind: "index", index: 1 })]), target);
    if (!made.ok) throw new Error(made.message);
    expect(widgetsIn(made.content)[0]!.attrs?.params?.day).toEqual({ kind: "index", index: 1 });
  });

  it("re-binds at every depth: inline, inside lists, quotes and a repeat's own attrs", () => {
    const pinned = { kind: "dayId", dayId: SOURCE_DAY };
    const made = instantiateTemplate(
      doc([
        { type: "paragraph", content: [cost(pinned)] },
        { type: "blockquote", content: [cost(pinned)] },
        { type: "bulletList", content: [{ type: "listItem", content: [cost(pinned)] }] },
        { type: "repeat", attrs: { name: "day.rows", params: { day: pinned } }, content: [] },
      ]),
      target,
    );
    if (!made.ok) throw new Error(made.message);
    const days = widgetsIn(made.content).map((w) => w.attrs?.params?.day);
    expect(days).toHaveLength(4);
    for (const day of days) expect(day).toEqual({ kind: "dayId", dayId: UNRESOLVED_DAY_ID });
  });

  // SPEC §25: one Overview per trip. A template saved FROM the Overview is an
  // ordinary notebook in the next trip.
  it("instantiates into the target trip as an ordinary notebook, never a second Overview", () => {
    const made = instantiateTemplate(doc([]), target);
    expect(made).toEqual({ ok: true, context: { tripId: target.tripId }, content: doc([]) });
  });

  // ADR-038 decision 3: a node this build cannot read is carried as it came.
  it("carries an unknown node byte-for-byte", () => {
    const future = { type: "someday", attrs: { day: { kind: "dayId", dayId: SOURCE_DAY } } };
    const made = instantiateTemplate({ v: CURRENT_PAGE_DOC_VERSION, type: "doc", content: [future] }, target);
    if (!made.ok) throw new Error(made.message);
    expect(serializePageDoc(made.content)).toEqual({ v: CURRENT_PAGE_DOC_VERSION, type: "doc", content: [future] });
  });
});

// **For ALL documents: no day id outside the target trip survives**, except
// inside a node this build cannot read (carried, see above). That is the claim
// the rule makes, so it is checked over generated documents rather than the
// handful above.
describe("instantiateTemplate — property", () => {
  const dayRefArb = fc.oneof(
    fc.record({ kind: fc.constant("index"), index: fc.nat({ max: 5 }) }),
    fc.record({
      kind: fc.constant("dayId"),
      dayId: fc.constantFrom(SOURCE_DAY, "5a0e0000-0000-4000-8000-00000000d002", ...target.dayIds),
    }),
  );
  const widgetArb = fc
    .record({ day: fc.option(dayRefArb, { nil: undefined }) })
    .map(({ day }) => ({ type: "macro", attrs: { name: "cost", params: day === undefined ? {} : { day } } }));
  const { node: nodeArb } = fc.letrec<{ node: unknown }>((tie) => ({
    node: fc.oneof(
      { depthSize: "small", withCrossShrink: true },
      widgetArb,
      fc.array(widgetArb, { maxLength: 3 }).map((content) => ({ type: "paragraph", content })),
      fc.array(tie("node"), { maxLength: 3 }).map((content) => ({ type: "blockquote", content })),
      fc
        .array(fc.array(tie("node"), { maxLength: 2 }), { maxLength: 2 })
        .map((items) => ({ type: "bulletList", content: items.map((content) => ({ type: "listItem", content })) })),
    ),
  }));

  it("leaves only the target trip's day ids, or the tombstone", () => {
    const w = witness("instantiateTemplate day ids");
    const allowed = new Set([...target.dayIds, UNRESOLVED_DAY_ID]);
    fc.assert(
      fc.property(fc.array(nodeArb, { maxLength: 4 }), (content) => {
        const made = instantiateTemplate({ v: CURRENT_PAGE_DOC_VERSION, type: "doc", content }, target);
        expect(made.ok).toBe(true);
        if (!made.ok) return;
        const inputIds = widgetsIn({ content }).flatMap((n) => (n.attrs?.params?.day as { dayId?: string })?.dayId ?? []);
        const outputIds = widgetsIn(made.content).flatMap((n) => (n.attrs?.params?.day as { dayId?: string })?.dayId ?? []);
        // Same number of pins: re-bound, never dropped (dropping widens to "All").
        expect(outputIds).toHaveLength(inputIds.length);
        for (const [i, id] of outputIds.entries()) {
          expect(allowed.has(id)).toBe(true);
          if (target.dayIds.includes(inputIds[i]!)) expect(id).toBe(inputIds[i]);
          w.tick();
        }
      }),
      { numRuns: 200 },
    );
    // Measured 2026-09-24 over nine runs: 215-258 pinned ids checked. The
    // floor is about half the minimum (witness.ts's rule).
    w.atLeast(105);
  });
});
