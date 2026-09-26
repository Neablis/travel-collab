// The page tool family's ADAPTER. The two tools moved to the assistant kernel
// (`@/server/assistant/tools/page`, ADR-043 decision 1), still derived from the
// `@tc/pages` macro registry and still delegating widget validation to
// `insertWidget`. What is left here is the validation the ROUTE runs over what
// a turn produced — which is not a tool and does not belong in the kernel.
//
// **P2 took `buildPageTools()` and `PAGE_TOOL_NAMES` out of it.** A page turn's
// tool set is `toolsFor(grant)` with the `pages` domain granted at `propose`
// (grants.ts), and the buffer is minted by the turn — so ADR-035 decision 5's
// "strictly smaller than `compose_page`" is now a row in the surface table
// rather than a builder plus a name list. The insert collector's own reason is
// unchanged and lives on `PageBuffer` (assistant/deps.ts): the inserts leave on
// the stream's `finish` part as message metadata, and by then the tool result
// is several SDK frames behind.
//
// `validateComposedPage` remains as defense-in-depth over the assembled result:
// it parses the AST and re-walks every macro node against the registry. Any
// failure returns { error } — the caller decides whether to downgrade or
// reject. /ask rejects: a doc that fails here never reaches the client.
import { PageDoc, migratePageDoc, newPageDoc } from "@tc/contracts";
import type { PageNode } from "@tc/contracts";
import { findWidgetError } from "@tc/pages";

// `insertWidgetParamsRule` lived here — the page prompt's sentence about which
// widgets take a non-filter param, built from the catalogue it sat above
// (KI-2026-09-05-i item 4). ADR-057 took the catalogue out of the prompt, and
// each `search_widgets` match now carries its own `params` with their allowed
// values, so the sentence had nothing left to summarise.

export type { PageInserts } from "@/server/assistant/deps";

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
  // The registry walk is `findWidgetError` in `@tc/pages` now — lifted so the
  // page WRITE path runs the identical check (KI-2026-09-05-g).
  const error = findWidgetError(doc.content);
  if (error) return { error };
  return doc;
}
