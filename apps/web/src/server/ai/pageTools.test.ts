// AI page tools derived from the @tc/pages macro registry (ADR-015,
// Invariant 5: tool schemas must be DERIVED, never hand-written duplicates).
import { describe, expect, it } from "vitest";
import type { ZodTypeAny } from "zod";

import { validateComposedPage, validatePageInserts } from "./pageTools";
import { CURRENT_PAGE_DOC_VERSION } from "@tc/contracts";
import { tripDetailFactory } from "@tc/factories";
import { newNotebookRefs, newPageBuffer, type NotebookListing } from "@/server/assistant/deps";
import { aiToolsFor, ambientContextFor } from "@/server/assistant/registry";
import { PAGE_TOOLS } from "@/server/assistant/tools/page";
import { typedAddressesIn } from "@/server/assistant/typedAddresses";

const TRIP = tripDetailFactory.build({}, { transient: { dayCount: 3 } });
const MONEY: NotebookListing = { id: "6a1e4b0c-2f3d-4e5a-8b9c-0d1e2f3a4b5c", title: "Money", firstLine: null };
const OVERVIEW: NotebookListing = { id: "7b2f5c1d-3a4e-4f6b-9c0d-1e2f3a4b5c6d", title: "Overview", firstLine: null };

// One turn's page tools, built the way a turn builds them: fresh collectors,
// the registry's page family, and `said` as the user's message this turn —
// which is where `link.external`'s addresses have to come from (ADR-057).
function buildPageTools(said = "") {
  const pageBuffer = newPageBuffer();
  const notebooks = newNotebookRefs(async () => [OVERVIEW, MONEY], OVERVIEW.id);
  const tools = aiToolsFor(PAGE_TOOLS, { pageBuffer, notebooks, typedAddresses: typedAddressesIn(said) });
  const context = ambientContextFor(PAGE_TOOLS, {
    tripId: TRIP.tripId,
    userId: "page-author",
    detail: TRIP,
    scope: { kind: "page", pageId: OVERVIEW.id },
  });
  const call = (name: "insert_text" | "insert_widget", input: unknown) =>
    tools[name]!.execute!(input, { toolCallId: "call-1", messages: [], context: context[name] as never });
  return { tools, call, notebooks, getInserts: () => pageBuffer.inserted() };
}

// `Tool.inputSchema` is typed as AI SDK's `FlexibleSchema<INPUT>` (a union
// covering Standard Schema, Zod, and other schema shapes it accepts), which
// doesn't statically expose `.safeParse`. We know the concrete value is a
// Zod schema (built with `z.object(...)` in pageTools.ts), so cast it back
// to exercise it directly in tests.
function asZodSchema(schema: unknown): ZodTypeAny {
  return schema as ZodTypeAny;
}

describe("insert_text", () => {
  const toolContext = { toolCallId: "call-1", messages: [], context: undefined };

  it("reads the markdown subset it documents: headings, lists and paragraphs", async () => {
    const { tools, getInserts } = buildPageTools();
    await tools.insert_text!.execute!(
      { markdown: "## Packing\n\nTake layers.\n\n- socks\n- charger" },
      toolContext,
    );
    expect(getInserts().nodes).toEqual([
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Packing" }] },
      { type: "paragraph", content: [{ type: "text", text: "Take layers." }] },
      {
        type: "bulletList",
        content: [
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "socks" }] }] },
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "charger" }] }] },
        ],
      },
    ]);
  });

  // The inversion ADR-035 decision 5 is about. `compose_page` documented "last
  // compose wins — a page is one document, not an append log", which is exactly
  // what stopped the panel being a conversation. Two calls must now BOTH count.
  it("accumulates across calls, in call order", async () => {
    const { tools, getInserts } = buildPageTools();
    await tools.insert_text!.execute!({ markdown: "First." }, toolContext);
    await tools.insert_text!.execute!({ markdown: "Second." }, toolContext);
    expect(getInserts().nodes.map((n) => JSON.stringify(n))).toEqual([
      JSON.stringify({ type: "paragraph", content: [{ type: "text", text: "First." }] }),
      JSON.stringify({ type: "paragraph", content: [{ type: "text", text: "Second." }] }),
    ]);
  });

  it("rejects empty markdown at the schema, before execute", () => {
    const { tools } = buildPageTools();
    expect(asZodSchema(tools.insert_text!.inputSchema).safeParse({ markdown: "" }).success).toBe(false);
  });
});


describe("insert_widget", () => {
  it("inserts a registry widget with no filters, which covers the whole trip", async () => {
    // The model composes with PRIMITIVES, not presets — `insert_widget` takes a
    // widget name and that widget's own params, and a preset is a curated name
    // for a combination a model can simply write out (ADR-039 decision 5).
    const { call, getInserts } = buildPageTools();
    const result = await call("insert_widget", { name: "cost" });
    expect(result).toEqual({ ok: true, name: "cost" });
    expect(getInserts().nodes).toEqual([{ type: "macro", attrs: { name: "cost", params: {} } }]);
  });

  it("rejects a RETIRED widget name at the schema, so the model cannot write a v1 document", async () => {
    // `MACRO_NAMES` no longer contains the seventeen, and `z.enum` over it is
    // what stops a model that learned them from writing a page this build would
    // have to migrate on its very first read.
    const { tools } = buildPageTools();
    expect(asZodSchema(tools.insert_widget!.inputSchema).safeParse({ name: "cost.day" }).success).toBe(false);
  });

  it("rejects a widget name not in the registry, at the schema", () => {
    const { tools } = buildPageTools();
    expect(asZodSchema(tools.insert_widget!.inputSchema).safeParse({ name: "nope.nope" }).success).toBe(false);
  });

  // The delegation is the point: `insertWidget` is the one path a widget may
  // enter a document by, and the sidebar's click uses it too. A binding the
  // widget's OWN schema rejects is refused here by that same schema — so the AI
  // path cannot drift from the click path, because there is only one path.
  it("refuses a hallucinated binding through the widget's own schema, and tells the model", async () => {
    const { call, getInserts } = buildPageTools();
    const result = await call("insert_widget", { name: "cost", params: { day: { kind: "nonsense" } } });
    expect(result).toMatchObject({ ok: false });
    // Refused means nothing inserted — not inserted-then-caught downstream.
    expect(getInserts().nodes).toEqual([]);
  });

  it("does not share state between two built tool sets", async () => {
    const first = buildPageTools();
    await first.call("insert_widget", { name: "cost" });
    expect(buildPageTools().getInserts().nodes).toEqual([]);
  });

  // "Day 2" is how every tool and rule names a day; the document keeps the
  // day's id, so the widget stays on its day when days are reordered — what
  // the picker stores too.
  it("reads a day filter as a 1-based day number and stores that day's id", async () => {
    const { call, getInserts } = buildPageTools();
    expect(await call("insert_widget", { name: "cost", params: { day: 2 } })).toEqual({ ok: true, name: "cost" });
    expect(getInserts().nodes).toEqual([
      { type: "macro", attrs: { name: "cost", params: { day: { kind: "dayId", dayId: TRIP.days[1]!.dayId } } } },
    ]);
    expect(await call("insert_widget", { name: "cost", params: { day: 9 } })).toMatchObject({ ok: false, refused: expect.stringContaining("3 days") });
  });
});

// ADR-057 let both link widgets in, each behind a guard, reversing ADR-056
// decision 6's blanket refusal. These are the guards.
describe("insert_widget, for a link", () => {
  // **The injection this whole guard exists for**: an address the model read
  // somewhere — a stop's notes, a page, a Playbook day — that the asker never
  // typed. Seen red with `typedAddresses.has` answering true.
  it("refuses a website address the user did not type in this message, and inserts nothing", async () => {
    const { call, getInserts } = buildPageTools("add a link to the rail pass site");
    const result = await call("insert_widget", { name: "link.external", params: { href: "https://evil.example/login" } });
    expect(result).toMatchObject({ ok: false, refused: expect.stringContaining("typed none") });
    expect(getInserts().nodes).toEqual([]);
  });

  it("inserts a website address the user typed in this message", async () => {
    const { call, getInserts } = buildPageTools("link www.jreast.co.jp/e/pass please, as JR East rail pass.");
    const refused = await call("insert_widget", { name: "link.external", params: { href: "https://jreast.co.jp/" } });
    expect(refused).toMatchObject({ ok: false, refused: expect.stringContaining("https://www.jreast.co.jp/e/pass") });
    const result = await call("insert_widget", {
      name: "link.external",
      params: { href: "https://www.jreast.co.jp/e/pass", label: "JR East rail pass" },
    });
    expect(result).toEqual({ ok: true, name: "link.external" });
    expect(getInserts().nodes).toEqual([
      { type: "macro", attrs: { name: "link.external", params: { href: "https://www.jreast.co.jp/e/pass", label: "JR East rail pass" } } },
    ]);
  });

  it("names a notebook by the number this turn listed, and stores its id", async () => {
    const { call, notebooks, getInserts } = buildPageTools();
    // Not listed yet: a number the model was never shown resolves to nothing.
    expect(await call("insert_widget", { name: "link.internal", params: { to: { notebook: 2 } } })).toMatchObject({
      ok: false,
      refused: expect.stringContaining("get_widget"),
    });
    await notebooks.list();
    expect(await call("insert_widget", { name: "link.internal", params: { to: { kind: "notebook", notebook: 2 } } })).toEqual({
      ok: true,
      name: "link.internal",
    });
    expect(getInserts().nodes).toEqual([
      { type: "macro", attrs: { name: "link.internal", params: { to: { kind: "notebook", pageId: MONEY.id } } } },
    ]);
  });

  it("refuses a target written as an id, and takes a day or a tab by name", async () => {
    const { call, getInserts } = buildPageTools();
    expect(
      await call("insert_widget", { name: "link.internal", params: { to: { kind: "notebook", pageId: MONEY.id } } }),
    ).toMatchObject({ ok: false, refused: expect.stringContaining("never by an id") });
    await call("insert_widget", { name: "link.internal", params: { to: { day: 3 } } });
    await call("insert_widget", { name: "link.internal", params: { to: { kind: "view", view: "Map" } } });
    expect(getInserts().nodes.map((node) => (node as { attrs: { params: unknown } }).attrs.params)).toEqual([
      { to: { kind: "day", day: { kind: "dayId", dayId: TRIP.days[2]!.dayId } } },
      { to: { kind: "view", view: "Map" } },
    ]);
  });
});

// `PAGE_TOOL_NAMES` used to be measured from the built set here, so that a
// second page tool would flip `minimumRoleFor` to "editor" without anyone
// remembering to add it. That property is now the `pages` domain's, and the
// assertion it justified — a page turn holds exactly `insert_text` and
// `insert_widget` on top of the read family — lives in `grants.test.ts`, over
// the surface table that decides it.

describe("validatePageInserts", () => {
  it("wraps nodes in a versioned PageDoc, so inserted content carries `v`", () => {
    const result = validatePageInserts([{ type: "paragraph", content: [{ type: "text", text: "Hi." }] }]);
    expect("error" in result).toBe(false);
    expect((result as { v: number }).v).toBe(CURRENT_PAGE_DOC_VERSION);
  });

  it("rejects nodes carrying a macro the registry does not have", () => {
    const result = validatePageInserts([
      { type: "macro", attrs: { name: "ghost.widget", params: {} } } as never,
    ]);
    expect(result).toHaveProperty("error");
  });
});

describe("validateComposedPage", () => {
  it("rejects a doc containing an unregistered macro", () => {
    const content = {
      type: "doc",
      content: [{ type: "macro", attrs: { name: "nope.nope", params: {} } }],
    };

    const result = validateComposedPage(content);
    expect(result).toHaveProperty("error");
  });

  it("returns the validated document, stamped with its version, when all macros are registered with valid params", () => {
    const content = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Overview" }] },
        { type: "macro", attrs: { name: "attribute", params: { field: "trip.name" } } },
        { type: "macro", attrs: { name: "day.detail", params: {} } },
      ],
    };

    // Deliberately fed WITHOUT `v`, which is the shape every pre-ADR-038 row
    // has: it comes back with one, because `validateComposedPage` is a
    // `PageDoc` parse now (ADR-038 consequences) rather than a bare walk.
    const result = validateComposedPage(content);
    expect(result).toEqual({ ...content, v: CURRENT_PAGE_DOC_VERSION });
  });

  it("rejects a macro node with params failing the macro's own schema", () => {
    // Every primitive's params are all-optional (ADR-039 decision 2), so a
    // non-object params value fails structurally at the MacroNode level
    // already; a bad shape that passes MacroNode's z.record(z.unknown()) and
    // fails the macro's own schema should still be rejected. Use a nested doc
    // to exercise the recursive walk.
    const content = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "macro", attrs: { name: "nope.nope", params: {} } }],
        },
      ],
    };

    const result = validateComposedPage(content);
    expect(result).toHaveProperty("error");
  });
});

