// AI page-authoring tools derived from the @tc/pages macro registry
// (ADR-015, Invariant 5: tool schemas must be DERIVED, never hand-written
// duplicates). This is the page-authoring counterpart to planning.ts.
//
// **ADR-033 Decision 4 changed this family's HOST, not this family.** It used
// to hang off the command endpoint's `generateText` call; it now hangs off the
// /ask agent's loop, offered only on a turn whose page scope the server has
// already verified (handleAskRequest.ts). The derivation is what had to
// survive that move intact, and it did: `macroNameEnum` is still
// `z.enum(MACRO_NAMES)` over the live registry, and `validateComposedPage`
// (pageTools.ts) still re-checks every macro node against that macro's OWN Zod
// schema.
//
// **ADR-035 decision 5 replaced `compose_page` with two narrower tools**, and
// the reason is a conversation rather than a preference. `compose_page` was
// documented "last compose wins — a page is one document, not an append log",
// which is right for a one-shot prompt box and wrong for a thread:
// `ComposePanel`'s own header names the failure ("a page that accumulated turns
// would have to decide what 'draft this page' means the second time"). Inserts
// have an obvious second time. So the surface became `insert_text` and
// `insert_widget`, which the ADR calls "strictly smaller than `compose_page`".
//
// `insert_widget` does NOT re-validate a widget. It calls `insertWidget` from
// @tc/pages — the one path a widget may enter a document by (ADR-037 decision
// 4), and the same call the sidebar's click makes. A hallucinated binding is
// refused by that widget's OWN Zod schema, so the AI path cannot drift from the
// click path because there is only one path.
import { z } from "zod";
import { MACRO_NAMES, insertWidget, type InsertError } from "@tc/pages";
import { markdownToPageNodes } from "@/server/ai/markdownToPageNodes";
import { defineTool, type AnyAssistantTool } from "@/server/assistant/defineTool";

// z.enum requires a non-empty tuple; MACRO_NAMES is a readonly string[] from
// the registry (guaranteed non-empty — the registry always defines macros).
const macroNameEnum = z.enum(MACRO_NAMES as [string, ...string[]]);

const InsertTextParams = z.object({
  markdown: z.string().min(1),
});

const InsertWidgetParams = z.object({
  name: macroNameEnum,
  params: z.record(z.unknown()).optional(),
});

// `insertWidget`'s refusal is a TYPED reason, not a sentence — and `output`
// being required is what surfaced that this tool had been handing the model a
// structured object nobody had ever described (KI-9's shape, at the tool
// boundary). Annotated `z.ZodType<InsertError>` so the compiler, not a reader,
// keeps this in step with `@tc/pages`: a third refusal reason fails to compile
// here until it is worded.
const InsertErrorSchema: z.ZodType<InsertError> = z.union([
  z.object({ reason: z.literal("unknown-widget"), name: z.string() }),
  z.object({ reason: z.literal("bad-params"), name: z.string(), message: z.string() }),
]);

export const insertTextTool = defineTool({
  name: "insert_text",
  description:
    "Insert prose into the page at the cursor. Takes markdown: headings (#), bullet lists (-), " +
    "ordered lists (1.) and paragraphs. Inline formatting like **bold** is not interpreted and " +
    "will appear literally, so write plain sentences.",
  domain: "pages",
  effect: "propose",
  spend: "none",
  input: InsertTextParams,
  output: z.object({ inserted: z.number() }),
  needs: ["pageBuffer"] as const,
  minimumRole: "editor",
  run: (params, deps) => {
    const inserted = markdownToPageNodes(params.markdown);
    deps.pageBuffer.insert(inserted);
    return { inserted: inserted.length };
  },
});

export const insertWidgetTool = defineTool({
  name: "insert_widget",
  description:
    "Insert one live trip-data widget into the page at the cursor. Widget names come from the " +
    "registry and cannot be invented. Most params are that widget's own filters, and every " +
    "filter is optional — omit them all and the widget covers the whole trip, which is a real " +
    "answer and usually the right one. A few widgets also take a NON-filter param that chooses " +
    "what they read or count; the catalogue lists each widget's params under `params`, with the exact " +
    "values allowed. `attribute` renders nothing without its `field`.",
  domain: "pages",
  effect: "propose",
  spend: "none",
  input: InsertWidgetParams,
  output: z.union([
    z.object({ ok: z.literal(true), name: z.string() }),
    z.object({ ok: z.literal(false), error: InsertErrorSchema }),
  ]),
  needs: ["pageBuffer"] as const,
  minimumRole: "editor",
  run: (params, deps) => {
    // **The validation is delegated, not repeated.** `insertWidget` is the
    // one path a widget may enter a document by (ADR-037 decision 4 — "there
    // is no way to put a widget into a document that skips validation"), and
    // the sidebar's click goes through the same call. So a hallucinated
    // binding is refused by the widget's OWN params schema here, exactly as
    // a malformed click would be, rather than by a second check written for
    // the AI path that could drift from the first.
    const result = insertWidget(params.name, params.params ?? {});
    if (!result.ok) {
      // Returned to the MODEL rather than thrown: a refused binding is
      // something it can correct on the next step, and a thrown tool error
      // ends the turn with nothing the user can act on.
      return { ok: false as const, error: result.error };
    }
    deps.pageBuffer.insert([result.node]);
    return { ok: true as const, name: params.name };
  },
});

// In call order, which is the order a page turn's tools are offered in:
// `toolsFor` preserves registry order, and the analytics record measures it.
export const PAGE_TOOLS: readonly AnyAssistantTool[] = [insertTextTool, insertWidgetTool];
