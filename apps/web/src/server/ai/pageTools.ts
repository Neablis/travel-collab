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
import type { AskStreamMetadata, DroppedInsert, PageNode } from "@tc/contracts";
import type { PageInserts } from "@/server/assistant/deps";
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

/**
 * **The same check, one node at a time** (KI-2026-09-26-r). What a turn's
 * inserts are judged by now, rather than `validatePageInserts` over the batch.
 *
 * The batch check was all-or-nothing: one node the registry refused turned
 * every node the turn produced into a `composeError`, so a single bad widget
 * cost the user the prose and the six good widgets around it — and the model,
 * which had been told each of them succeeded, said so. Each node now gets the
 * identical parse and registry walk on its own; the ones that pass are kept in
 * call order, and each one that does not is named so the route can put it in
 * front of the user and on the `ai.ask` record.
 *
 * `doc` is null when nothing survived.
 */
export function validateInsertsPerNode(nodes: readonly PageNode[]): {
  doc: PageDoc | null;
  dropped: DroppedInsert[];
} {
  const kept: PageNode[] = [];
  const dropped: DroppedInsert[] = [];
  for (const node of nodes) {
    const checked = validatePageInserts([node]);
    if ("error" in checked) {
      const attrs = (node as { attrs?: { name?: unknown } }).attrs;
      dropped.push({
        name: node.type === "macro" && typeof attrs?.name === "string" ? attrs.name : "text",
        reason: checked.error,
      });
    } else {
      kept.push(...checked.content);
    }
  }
  if (kept.length === 0) return { doc: null, dropped };
  // Re-assembled through the same check, so the document that leaves is one
  // the batch validator would also pass — the nodes are each valid already.
  const doc = validatePageInserts(kept);
  return "error" in doc ? { doc: null, dropped: [...dropped, { name: "page", reason: doc.error }] } : { doc, dropped };
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
/**
 * What the turn wants inserted, on the run's final chunk — or the reason there
 * is nothing.
 *
 * **Validation runs HERE, before a byte leaves the server.** `insert_widget`'s
 * schema closes the widget NAME against the registry and `insertWidget` checks
 * its params, so this is the second look rather than the only one — but it is
 * the one that sees the assembled result, including whatever `insert_text`
 * produced. The endpoint this replaced answered a bad doc with a 422; a stream
 * has already sent its 200, so the refusal rides out as data the client renders
 * — the nodes themselves still never reach it.
 *
 * **There is no approval step, and that is deliberate.** The nodes land in the
 * editor and the Notebook's existing debounced autosave persists them — which
 * is what `onApply` has always expected. A proposal exists because a planning
 * batch commits events; inserted prose is text in an editor the user is looking
 * at, and interposing an Approve button between asking and seeing it would be a
 * new step this move did not ask for.
 *
 * **Nothing inserted is not an error the way no page composed was.** A turn can
 * legitimately answer a question about the page without editing it — that is
 * most of what a conversation does — so an empty insert list is silence, not a
 * failure. Only a turn that produced nodes which fail validation reports one.
 */
export function pageInsertsMetadata(inserts: PageInserts): AskStreamMetadata {
  const { doc, dropped } = pageOutcomeOf(inserts);
  if (doc !== null) return { pageInserts: { content: doc, ...(dropped.length > 0 ? { dropped } : {}) } };
  if (dropped.length === 0) return {};
  return { composeError: droppedSentence(dropped) };
}

/**
 * What a page turn's inserts come to: the document that lands, and every insert
 * that does not — the final check's drops AFTER the call-time refusals the
 * model never corrected, since those happened first.
 *
 * **Per node since KI-2026-09-26-r.** This was `validatePageInserts` over the
 * whole batch, so one node the registry refused turned the turn's every insert
 * into a `composeError`: the prose and each good widget went with it, and the
 * model, told each call had succeeded, said so. Read by `messageMetadata` and by
 * the recorder, so the stream and the `ai.ask` record cannot disagree.
 */
export function pageOutcomeOf(inserts: PageInserts): { doc: PageDoc | null; dropped: DroppedInsert[] } {
  if (inserts.nodes.length === 0) return { doc: null, dropped: [...inserts.refused] };
  const { doc, dropped } = validateInsertsPerNode(inserts.nodes);
  return { doc, dropped: [...inserts.refused, ...dropped] };
}

/** The refusal a turn with nothing left to insert ends on, naming what was dropped. */
function droppedSentence(dropped: readonly DroppedInsert[]): string {
  const names = [...new Set(dropped.map((entry) => entry.name))].join(", ");
  return `Nothing was added to the page. Refused: ${names} — ${dropped[0]!.reason}`;
}

