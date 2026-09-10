// The page tool family's ADAPTER. The two tools moved to the assistant kernel
// (`@/server/assistant/tools/page`, ADR-043 decision 1), still derived from the
// `@tc/pages` macro registry and still delegating widget validation to
// `insertWidget`. What is left here is the builder `handleAskRequest` calls and
// the validation the ROUTE runs over what a turn produced — which is not a tool
// and does not belong in the kernel.
//
// `validateComposedPage` remains as defense-in-depth over the assembled result:
// it parses the AST and re-walks every macro node against the registry. Any
// failure returns { error } — the caller decides whether to downgrade or
// reject. /ask rejects: a doc that fails here never reaches the client.
import type { Tool } from "ai";
import { MacroNode, PageDoc, migratePageDoc, newPageDoc } from "@tc/contracts";
import type { PageNode } from "@tc/contracts";
import { getMacro } from "@tc/pages";
import { newPageBuffer, type PageInserts } from "@/server/assistant/deps";
import { aiToolsFor } from "@/server/assistant/registry";
import { PAGE_TOOLS } from "@/server/assistant/tools/page";

export type { PageInserts } from "@/server/assistant/deps";

/**
 * The page tools, and a reader for what the turn wants inserted.
 *
 * The collector is now a declared dependency (`needs: ["pageBuffer"]`) rather
 * than a closure this function captured; all this mints is the buffer for one
 * turn. Its reason for existing is unchanged: the inserts leave on the stream's
 * `finish` part as message metadata, and by then the tool result is several SDK
 * frames behind — the same reason the write tools collect. `run` still returns,
 * so the model sees its own result and can talk about what it added.
 *
 * ADR-035 decision 5: this surface is "strictly smaller than `compose_page`",
 * and it is — two narrow tools over one broad one, with the widget half
 * delegating validation entirely rather than re-implementing it.
 */
export function buildPageTools(): { tools: Record<string, Tool>; getInserts: () => PageInserts } {
  const pageBuffer = newPageBuffer();
  return { tools: aiToolsFor(PAGE_TOOLS, { pageBuffer }), getInserts: () => pageBuffer.inserted() };
}

export const PAGE_TOOL_NAMES: readonly string[] = Object.keys(buildPageTools().tools);

// ADR-038's consequences: "`validateComposedPage` stops being special. It
// becomes 'parse the doc', the same call every other path makes." Half of that
// is now literally true — the AST parse below is the same one the route and the
// editor make. The registry walk that follows it is the half that stays
// special, and rightly: `PageDoc` can say a `macro` node is well-formed, but
// only the registry knows whether `cost` exists and what params it takes,
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
  // **Migrated before it is walked, not merely parsed.** `PageDoc` defaults a
  // missing `v` to 1 (ADR-038 decision 2 — every stored row without one IS v1),
  // and the nodes assembled here were built by THIS build, so they are at the
  // current version and simply carry no label. Returning them stamped v1 would
  // write a document whose content is v2 under a v1 heading, and every later
  // read would re-run a migration over names that had already been migrated.
  //
  // Running the chain is also the honest way to reach the current version: it
  // is a no-op over names that are already primitives, and it corrects the one
  // case that would otherwise be a silent wrong answer — a retired name that
  // reached here around the tool's own enum.
  let doc: PageDoc;
  try {
    doc = migratePageDoc(parsed.data);
  } catch (error) {
    // A document claiming a version this build does not understand. Refusing is
    // the same answer `parsePageDoc` gives, and the caller (/ask) rejects.
    return { error: `Invalid page document: ${(error as Error).message}` };
  }
  const error = walkForError(doc.content);
  if (error) return { error };
  return doc;
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
