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
// The compose_page tool's `inputSchema` describes a flat, AI-friendly page
// shape (title + blocks), NOT the full nested ProseMirror doc. The macro
// `name` param is a closed Zod enum over MACRO_NAMES, so an unknown macro
// name fails schema validation before it ever reaches a document. execute()
// converts the simplified shape into PageContent-shaped JSON, mirroring the
// heading()/para()/macro() helper pattern in packages/pages/src/templates.ts.
//
// validateComposedPage is defense-in-depth: given an already-built
// PageContent, it walks every node and re-validates each macro node against
// @tc/contracts' MacroNode schema, confirms the macro is still in the
// registry, and checks its params against that macro's own Zod schema.
// Any failure returns { error } — the caller decides whether to downgrade or
// reject. /ask rejects: a doc that fails here never reaches the client.
import { tool, type Tool } from "ai";
import { z } from "zod";
import { MacroNode, PageDoc, newPageDoc } from "@tc/contracts";
import type {
  PageHeadingNode,
  PageNode,
  PageParagraphNode,
  PageWidgetNode,
} from "@tc/contracts";
import { MACRO_NAMES, getMacro } from "@tc/pages";

// z.enum requires a non-empty tuple; MACRO_NAMES is a readonly string[] from
// the registry (guaranteed non-empty — the registry always defines macros).
const macroNameEnum = z.enum(MACRO_NAMES as [string, ...string[]]);

const HeadingBlock = z.object({
  type: z.literal("heading"),
  level: z.number().int().min(1).max(6),
  text: z.string().min(1),
});

const ParagraphBlock = z.object({
  type: z.literal("paragraph"),
  text: z.string().min(1),
});

const MacroBlock = z.object({
  type: z.literal("macro"),
  name: macroNameEnum,
  params: z.record(z.unknown()).optional(),
});

const Block = z.discriminatedUnion("type", [HeadingBlock, ParagraphBlock, MacroBlock]);

const ComposePageParams = z.object({
  title: z.string().min(1),
  blocks: z.array(Block),
});

type ComposePageParams = z.infer<typeof ComposePageParams>;

// Mirrors packages/pages/src/templates.ts's heading()/para()/macro() helpers,
// and typed against the AST for the same reason they are (ADR-038): this is a
// producer of stored page content, and the write path is `PageDoc` now, so a
// block shape that drifts out of the vocabulary should fail to compile here
// rather than 400 at the route with a document already streamed to a user.
//
// `heading`'s level is cast because `ComposePageParams` types it as a plain
// int 1-6 while the AST types it as the union of those six literals. The two
// ranges are the same range — deliberately, see `PageHeadingNode`'s comment,
// which records Mitchell's 2026-09-03 call to widen the AST to the tool rather
// than narrow the tool to the AST.
const heading = (level: number, text: string): PageHeadingNode => ({
  type: "heading",
  attrs: { level: level as PageHeadingNode["attrs"]["level"] },
  content: [{ type: "text", text }],
});
const para = (text: string): PageParagraphNode => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});
const macro = (name: string, params: Record<string, unknown> = {}): PageWidgetNode => ({
  type: "macro",
  attrs: { name, params },
});

function toPageDoc(params: ComposePageParams): PageDoc {
  const content: PageNode[] = params.blocks.map((block) => {
    switch (block.type) {
      case "heading":
        return heading(block.level, block.text);
      case "paragraph":
        return para(block.text);
      case "macro":
        return macro(block.name, block.params ?? {});
    }
  });
  return newPageDoc(content);
}

/** What one `compose_page` call produced. */
export interface ComposedPage {
  title: string;
  content: PageDoc;
}

/**
 * The page tools, and a reader for what the turn composed.
 *
 * The collector exists because the composed doc leaves on the stream's `finish`
 * part as message metadata, and by then the tool result is several SDK frames
 * behind — the same reason `buildWriteTools` collects rather than returning
 * (writeTools.ts). `execute` is otherwise unchanged: it still transforms and
 * returns, so the model sees its own result and can talk about it.
 *
 * **Last compose wins.** A model that calls this twice meant the second one;
 * a page is one document, not an append log.
 */
export function buildPageTools(): { tools: Record<string, Tool>; getComposed: () => ComposedPage | null } {
  let composed: ComposedPage | null = null;
  const tools: Record<string, Tool> = {
    compose_page: tool({
      description:
        "Compose a page as a title and an ordered list of blocks (headings, paragraphs, and macros). " +
        "Macro names are limited to the trip data registry — do not invent macro names.",
      inputSchema: ComposePageParams,
      execute: async (params: ComposePageParams) => {
        composed = { title: params.title, content: toPageDoc(params) };
        return composed;
      },
    }),
  };

  return { tools, getComposed: () => composed };
}

/**
 * The page tools, by name — MEASURED from the built set, never listed, for the
 * same reason `WRITE_TOOL_NAMES` is (writeTools.ts): `minimumRoleFor` computes
 * the guard from the tool names it is handed, so a second page tool inherits
 * the editor requirement without anyone remembering to add it here.
 */
export const PAGE_TOOL_NAMES: readonly string[] = Object.keys(buildPageTools().tools);

// ADR-038's consequences: "`validateComposedPage` stops being special. It
// becomes 'parse the doc', the same call every other path makes." Half of that
// is now literally true — the AST parse below is the same one the route and the
// editor make. The registry walk that follows it is the half that stays
// special, and rightly: `PageDoc` can say a `macro` node is well-formed, but
// only the registry knows whether `cost.trip` exists and what params it takes,
// and contracts cannot import the registry.
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
