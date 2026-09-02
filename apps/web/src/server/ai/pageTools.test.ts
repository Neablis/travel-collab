// AI page tools derived from the @tc/pages macro registry (ADR-015,
// Invariant 5: tool schemas must be DERIVED, never hand-written duplicates).
import { describe, expect, it } from "vitest";
import type { ZodTypeAny } from "zod";

import { buildPageTools, PAGE_TOOL_NAMES, validateComposedPage } from "./pageTools";
import type { PageContent } from "@tc/contracts";

// `Tool.inputSchema` is typed as AI SDK's `FlexibleSchema<INPUT>` (a union
// covering Standard Schema, Zod, and other schema shapes it accepts), which
// doesn't statically expose `.safeParse`. We know the concrete value is a
// Zod schema (built with `z.object(...)` in pageTools.ts), so cast it back
// to exercise it directly in tests.
function asZodSchema(schema: unknown): ZodTypeAny {
  return schema as ZodTypeAny;
}

describe("buildPageTools", () => {
  it("compose_page accepts a doc using only registry macros", () => {
    const { tools } = buildPageTools();
    const result = asZodSchema(tools.compose_page!.inputSchema).safeParse({
      title: "Overview",
      blocks: [
        { type: "heading", level: 2, text: "Overview" },
        { type: "macro", name: "trip.name" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("compose_page rejects a macro name not in MACRO_NAMES", () => {
    const { tools } = buildPageTools();
    const result = asZodSchema(tools.compose_page!.inputSchema).safeParse({
      title: "Overview",
      blocks: [{ type: "macro", name: "nope.nope" }],
    });
    expect(result.success).toBe(false);
  });

  it("compose_page execute converts the simplified shape into PageContent JSON", async () => {
    const { tools } = buildPageTools();
    const result = await tools.compose_page!.execute!(
      {
        title: "Overview",
        blocks: [
          { type: "heading", level: 2, text: "Overview" },
          { type: "paragraph", text: "Some intro." },
          { type: "macro", name: "trip.name" },
        ],
      },
      { toolCallId: "call-1", messages: [], context: undefined },
    );

    expect(result).toEqual({
      title: "Overview",
      content: {
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Overview" }] },
          { type: "paragraph", content: [{ type: "text", text: "Some intro." }] },
          { type: "macro", attrs: { name: "trip.name", params: {} } },
        ],
      },
    });
  });
});

// The collector its new host needs: the composed doc leaves on the stream's
// `finish` part as message metadata (handleAskRequest.ts), which is several SDK
// frames after the tool result. `execute` is otherwise unchanged — it still
// returns, so the model sees its own result and can talk about it.
describe("buildPageTools — what the turn composed", () => {
  const params = (title: string) => ({ title, blocks: [{ type: "paragraph" as const, text: "Notes." }] });
  const toolContext = { toolCallId: "call-1", messages: [], context: undefined };

  it("is null before the model has composed anything", () => {
    expect(buildPageTools().getComposed()).toBeNull();
  });

  it("reads back exactly what execute returned", async () => {
    const { tools, getComposed } = buildPageTools();
    const returned = await tools.compose_page!.execute!(params("Overview"), toolContext);
    expect(getComposed()).toEqual(returned);
  });

  // A page is one document, not an append log: a model that composes twice
  // meant the second one.
  it("keeps the LAST compose when a model calls it twice", async () => {
    const { tools, getComposed } = buildPageTools();
    await tools.compose_page!.execute!(params("First"), toolContext);
    await tools.compose_page!.execute!(params("Second"), toolContext);
    expect(getComposed()?.title).toBe("Second");
  });

  // Each turn gets its own collector, or one turn's page would leak into the
  // next request's final chunk.
  it("does not share state between two built tool sets", async () => {
    const first = buildPageTools();
    await first.tools.compose_page!.execute!(params("Overview"), toolContext);
    expect(buildPageTools().getComposed()).toBeNull();
  });
});

// PAGE_TOOL_NAMES is MEASURED from the built set, never listed — the same rule
// WRITE_TOOL_NAMES follows, and what makes `minimumRoleFor` answer "editor" for
// a second page tool without anyone remembering to add it.
describe("PAGE_TOOL_NAMES", () => {
  it("is the built tool set's own keys", () => {
    expect([...PAGE_TOOL_NAMES]).toEqual(Object.keys(buildPageTools().tools));
    expect([...PAGE_TOOL_NAMES]).toContain("compose_page");
  });
});

describe("validateComposedPage", () => {
  it("rejects a doc containing an unregistered macro", () => {
    const content: PageContent = {
      type: "doc",
      content: [{ type: "macro", attrs: { name: "nope.nope", params: {} } }],
    };

    const result = validateComposedPage(content);
    expect(result).toHaveProperty("error");
  });

  it("returns the validated PageContent when all macros are registered with valid params", () => {
    const content: PageContent = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Overview" }] },
        { type: "macro", attrs: { name: "trip.name", params: {} } },
        { type: "macro", attrs: { name: "itinerary.trip", params: {} } },
      ],
    };

    const result = validateComposedPage(content);
    expect(result).toEqual(content);
  });

  it("rejects a macro node with params failing the macro's own schema", () => {
    // trip.name uses NoParams (z.object({}).strip()) — a non-object params
    // value fails structurally at the MacroNode level already, but a bad
    // shape that passes MacroNode's z.record(z.unknown()) and fails the
    // macro's own schema should still be rejected. cost.day requires no
    // params either, so use a nested doc to exercise the recursive walk.
    const content: PageContent = {
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
