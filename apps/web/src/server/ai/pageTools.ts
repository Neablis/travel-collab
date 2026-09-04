// AI page-authoring tools derived from the @tc/pages macro registry
// (ADR-015, Invariant 5: tool schemas must be DERIVED, never hand-written
// duplicates). This is the page-authoring counterpart to planningTools.ts.
//
// **ADR-033 Decision 4 changed this family's HOST, not this family.** It used
// to hang off the command endpoint's `generateText` call; it now hangs off the
// /ask agent's loop, offered only on a turn whose page scope the server has
// already verified (handleAskRequest.ts). The derivation is what had to
// survive that move intact, and it did: `macroNameEnum` is still
// `z.enum(MACRO_NAMES)` over the live registry, and `validateComposedPage`
// still re-checks every macro node against that macro's OWN Zod schema.
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
//
// `validateComposedPage` remains as defense-in-depth over the assembled result:
// it parses the AST and re-walks every macro node against the registry. Any
// failure returns { error } — the caller decides whether to downgrade or
// reject. /ask rejects: a doc that fails here never reaches the client.
import { tool, type Tool } from "ai";
import { z } from "zod";
import { MacroNode, PageDoc, newPageDoc } from "@tc/contracts";
import type { PageNode } from "@tc/contracts";
import { MACRO_NAMES, getMacro, insertWidget } from "@tc/pages";
import { markdownToPageNodes } from "./markdownToPageNodes";

// z.enum requires a non-empty tuple; MACRO_NAMES is a readonly string[] from
// the registry (guaranteed non-empty — the registry always defines macros).
const macroNameEnum = z.enum(MACRO_NAMES as [string, ...string[]]);

/**
 * What one turn's page tools produced: an ordered list of nodes to insert.
 *
 * **This replaces `ComposedPage`, and the inversion is the whole point.**
 * `compose_page` documented itself as "last compose wins — a page is one
 * document, not an append log", which was right for a one-shot box. It is
 * exactly wrong for a conversation: `ComposePanel`'s own header names the
 * problem ("a page that accumulated turns would have to decide what 'draft this
 * page' means the second time"), and the answer ADR-035 decision 5 gives is to
 * stop composing documents and start inserting into one. Every call counts, in
 * call order, and the second turn adds to the first instead of erasing it.
 */
export interface PageInserts {
  nodes: PageNode[];
}

const InsertTextParams = z.object({
  markdown: z.string().min(1),
});

const InsertWidgetParams = z.object({
  name: macroNameEnum,
  params: z.record(z.unknown()).optional(),
});

/**
 * The page tools, and a reader for what the turn wants inserted.
 *
 * The collector exists because the inserts leave on the stream's `finish` part
 * as message metadata, and by then the tool result is several SDK frames behind
 * — the same reason `buildWriteTools` collects rather than returning
 * (writeTools.ts). `execute` still returns, so the model sees its own result and
 * can talk about what it added.
 *
 * ADR-035 decision 5: this surface is "strictly smaller than `compose_page`",
 * and it is — two narrow tools over one broad one, with the widget half
 * delegating validation entirely rather than re-implementing it.
 */
export function buildPageTools(): { tools: Record<string, Tool>; getInserts: () => PageInserts } {
  const nodes: PageNode[] = [];
  const tools: Record<string, Tool> = {
    insert_text: tool({
      description:
        "Insert prose into the page at the cursor. Takes markdown: headings (#), bullet lists (-), " +
        "ordered lists (1.) and paragraphs. Inline formatting like **bold** is not interpreted and " +
        "will appear literally, so write plain sentences.",
      inputSchema: InsertTextParams,
      execute: async (params: z.infer<typeof InsertTextParams>) => {
        const inserted = markdownToPageNodes(params.markdown);
        nodes.push(...inserted);
        return { inserted: inserted.length };
      },
    }),

    insert_widget: tool({
      description:
        "Insert one live trip-data widget into the page at the cursor. Widget names come from the " +
        "registry and cannot be invented. Params are that widget's own — omit them to insert it " +
        "unbound, which is valid and lets the reader point it afterwards.",
      inputSchema: InsertWidgetParams,
      execute: async (params: z.infer<typeof InsertWidgetParams>) => {
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
        nodes.push(result.node);
        return { ok: true as const, name: params.name };
      },
    }),
  };

  return { tools, getInserts: () => ({ nodes: [...nodes] }) };
}

export const PAGE_TOOL_NAMES: readonly string[] = Object.keys(buildPageTools().tools);

// ADR-038's consequences: "`validateComposedPage` stops being special. It
// becomes 'parse the doc', the same call every other path makes." Half of that
// is now literally true — the AST parse below is the same one the route and the
// editor make. The registry walk that follows it is the half that stays
// special, and rightly: `PageDoc` can say a `macro` node is well-formed, but
// only the registry knows whether `cost.trip` exists and what params it takes,
// and contracts cannot import the registry.
/**
 * The same check, for what a turn wants inserted.
 *
 * Wrapping the nodes in a `PageDoc` rather than writing a second walker is the
 * point: inserted nodes are page content, so they get page content's validation
 * — the identical parse and the identical registry walk — instead of a parallel
 * one that could come to disagree with it.
 */
export function validatePageInserts(nodes: readonly PageNode[]): PageDoc | { error: string } {
  return validateComposedPage(newPageDoc([...nodes]));
}

export function validateComposedPage(content: unknown): PageDoc | { error: string } {
  const parsed = PageDoc.safeParse(content);
  if (!parsed.success) return { error: `Invalid page document: ${parsed.error.message}` };
  const error = walkForError(parsed.data.content);
  if (error) return { error };
  return parsed.data;
}

function walkForError(nodes: readonly unknown[]): string | null {
  for (const node of nodes) {
    if (typeof node !== "object" || node === null) continue;
    const record = node as Record<string, unknown>;

    if (record.type === "macro") {
      const parsed = MacroNode.safeParse(node);
      if (!parsed.success) {
        return `Invalid macro node: ${parsed.error.message}`;
      }
      const { name, params } = parsed.data.attrs;
      const def = getMacro(name);
      if (!def) {
        return `Unknown macro "${name}" is not in the registry.`;
      }
      const paramsResult = def.params.safeParse(params);
      if (!paramsResult.success) {
        return `Macro "${name}" params failed validation: ${paramsResult.error.message}`;
      }
      continue;
    }

    const nestedContent = record.content;
    if (Array.isArray(nestedContent)) {
      const nestedError = walkForError(nestedContent);
      if (nestedError) return nestedError;
    }
  }
  return null;
}
