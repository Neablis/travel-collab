import { PageDoc, collectPageDocNodeTypes, migratePageDoc, serializePageDoc } from "@tc/contracts";
import { PAGE_EDITOR_NODE_TYPES } from "./extensions";

// ADR-038 decision 4, and the seam where its two representations meet: is this
// stored document safe to hand to TipTap?
//
// **Decision 4's stated criterion does not answer that question, and this is
// the correction.** As written it says: parse the document, re-serialise it,
// and open read-only if the result is not equivalent to what was stored. Both
// halves of the failure it exists to prevent pass that test — measured
// 2026-09-03:
//
//   * a `repeat` node is a known type in `PageDoc` with no TipTap extension
//     behind it, so it parses and re-serialises BYTE-IDENTICALLY;
//   * an unknown node re-serialises byte-identically too, because that is
//     precisely what decision 3 promises.
//
// Both mount, and TipTap discards the whole document for both. Round-tripping
// proves a document survives OUR parser; it says nothing about the editor, and
// the editor is what eats the page. So the guard asks the question that
// actually decides the outcome: **does this document use any node type the
// editor's schema has no definition for?**
//
// Two ways a page is unsafe, and they want different words on screen:
//
//   * `unreadable` — `PageDoc` could not parse it (a malformed known node, or a
//     `v` from the future). There is no AST, so there is nothing to render and
//     nothing safe to write back.
//   * `unsupported` — it parsed, so we can render it read-only, but it contains
//     node types this build's editor cannot mount. This is the rolling-deploy
//     and stale-tab case, and the one decision 3 exists for.
export type StoredPageDoc =
  | { status: "mountable"; doc: PageDoc }
  | { status: "unsupported"; doc: PageDoc; unsupportedTypes: readonly string[] }
  | { status: "unreadable"; message: string };

export function inspectStoredPageDoc(raw: unknown): StoredPageDoc {
  const parsed = PageDoc.safeParse(raw);
  if (!parsed.success) {
    return { status: "unreadable", message: parsed.error.issues[0]?.message ?? "unparseable document" };
  }
  let doc: PageDoc;
  try {
    // A document from the future throws rather than being guessed at — see
    // `migratePageDoc`. That is an `unreadable` page, not a broken one.
    doc = migratePageDoc(parsed.data);
  } catch (err) {
    return { status: "unreadable", message: err instanceof Error ? err.message : "unmigratable document" };
  }

  const unsupportedTypes = [...collectPageDocNodeTypes(doc)]
    .filter((type) => !PAGE_EDITOR_NODE_TYPES.has(type))
    .sort();

  return unsupportedTypes.length > 0
    ? { status: "unsupported", doc, unsupportedTypes }
    : { status: "mountable", doc };
}

// The save half of the same guard, and the reason a write is not just
// `editor.getJSON()` going straight down the wire.
//
// **One rule, both directions: we write only what we would open.** It reuses
// `inspectStoredPageDoc` rather than doing its own parse, which is not tidiness
// — it is what makes the cast below true by construction. A `mountable`
// document contains no `unknown` nodes, and an unknown node is the only thing
// `serializePageDoc` emits that is not a `PageDoc` node (it puts the original
// `raw` back verbatim, which is by definition a shape this build cannot type).
// Parsing separately here would leave that as an argument about call sites
// instead of a fact about the value.
//
// Two jobs beyond the refusal. It stamps `v` (decision 2 — "every document
// carries `v`, and it is written on every save"), which `getJSON()` knows
// nothing about. And it is the last check before a write: what the editor
// produced gets the same scrutiny as what the database returned. TipTap is a
// dependency we upgrade, and the failure a bad upgrade causes is silent
// truncation of somebody's notebook.
//
// `null` means "do not write this", and the caller owes the user an
// explanation rather than a retry.
export function toStoredPageDoc(json: unknown): PageDoc | null {
  const inspected = inspectStoredPageDoc(json);
  if (inspected.status !== "mountable") return null;
  return serializePageDoc(inspected.doc) as PageDoc;
}
