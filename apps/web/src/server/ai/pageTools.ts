// AI page-authoring tools derived from the @tc/pages macro registry
// (ADR-015, Invariant 5: tool schemas must be DERIVED, never hand-written
// duplicates). This is the page-authoring counterpart to planningTools.ts.
//
// The compose_page tool's `parameters` describe a flat, AI-friendly page
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
// Any failure returns { error } — the route (Task 5.5) decides whether to
// downgrade or reject.
import { tool, type Tool } from "ai";
import { z } from "zod";
import { MacroNode, type PageContent } from "@tc/contracts";
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

// Mirrors packages/pages/src/templates.ts's heading()/para()/macro() helpers.
const heading = (level: number, text: string) => ({
  type: "heading",
  attrs: { level },
  content: [{ type: "text", text }],
});
const para = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const macro = (name: string, params: Record<string, unknown> = {}) => ({
  type: "macro",
  attrs: { name, params },
});

function toPageContent(params: ComposePageParams): PageContent {
  const content = params.blocks.map((block) => {
    switch (block.type) {
      case "heading":
        return heading(block.level, block.text);
      case "paragraph":
        return para(block.text);
      case "macro":
        return macro(block.name, block.params ?? {});
    }
  });
  return { type: "doc", content };
}

export function buildPageTools(): { tools: Record<string, Tool> } {
  const tools: Record<string, Tool> = {
    compose_page: tool({
      description:
        "Compose a page as a title and an ordered list of blocks (headings, paragraphs, and macros). " +
        "Macro names are limited to the trip data registry — do not invent macro names.",
      parameters: ComposePageParams,
      execute: async (params: ComposePageParams) => {
        return { title: params.title, content: toPageContent(params) };
      },
    }),
  };

  return { tools };
}

export function validateComposedPage(content: PageContent): PageContent | { error: string } {
  const error = walkForError(content.content);
  if (error) return { error };
  return content;
}

function walkForError(nodes: unknown[]): string | null {
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
