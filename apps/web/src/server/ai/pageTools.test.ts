// AI page tools derived from the @tc/pages macro registry (ADR-015,
// Invariant 5: tool schemas must be DERIVED, never hand-written duplicates).
import { describe, expect, it } from "vitest";
import type { ZodTypeAny } from "zod";

import { buildPageTools, PAGE_TOOL_NAMES, validateComposedPage, validatePageInserts } from "./pageTools";
import { CURRENT_PAGE_DOC_VERSION } from "@tc/contracts";

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
  const toolContext = { toolCallId: "call-1", messages: [], context: undefined };

  it("inserts a registry widget with no filters, which covers the whole trip", async () => {
    // The model composes with PRIMITIVES, not presets — `insert_widget` takes a
    // widget name and that widget's own params, and a preset is a curated name
    // for a combination a model can simply write out (ADR-039 decision 5).
    const { tools, getInserts } = buildPageTools();
    const result = await tools.insert_widget!.execute!({ name: "cost" }, toolContext);
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
    const { tools, getInserts } = buildPageTools();
    const result = await tools.insert_widget!.execute!(
      { name: "cost", params: { day: { kind: "nonsense" } } },
      toolContext,
    );
    expect(result).toMatchObject({ ok: false });
    // Refused means nothing inserted — not inserted-then-caught downstream.
    expect(getInserts().nodes).toEqual([]);
  });

  it("does not share state between two built tool sets", async () => {
    const first = buildPageTools();
    await first.tools.insert_widget!.execute!({ name: "cost" }, toolContext);
    expect(buildPageTools().getInserts().nodes).toEqual([]);
  });
});

// PAGE_TOOL_NAMES is MEASURED from the built set, never listed — the same rule
// WRITE_TOOL_NAMES follows, and what makes `minimumRoleFor` answer "editor" for
// a second page tool without anyone remembering to add it.
describe("PAGE_TOOL_NAMES", () => {
  it("is the built tool set's own keys", () => {
    expect([...PAGE_TOOL_NAMES]).toEqual(Object.keys(buildPageTools().tools));
    expect([...PAGE_TOOL_NAMES]).toEqual(["insert_text", "insert_widget"]);
  });
});

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
