import { z } from "zod";
import { MacroNode } from "./pages";

// The stored notebook document, as a versioned AST (ADR-038). `PageContent`
// next door is what this replaces: `z.array(z.unknown())` is not an AST, it is
// a hole with a type annotation, and it is why nothing on any write path can
// say whether a stored page is valid or what format it was written in.
//
// The loss ADR-038 was written about is measured, not theorised. See
// `apps/web/src/components/pages/editor/PageEditor.test.tsx`, "PageEditor given
// a node type the schema does not know": TipTap catches ProseMirror's
// `RangeError: Unknown node type`, warns to the console, and mounts an EMPTY
// document — then `PageScreen` autosaves that over the original 800 ms later.
// The blast radius is the whole page, not the unrecognised node, and there is
// no TipTap option that turns it into a refusal (`enableContentCheck: true`
// only adds a `contentError` event before the same fallback runs). So the
// refusal has to be ours, and it needs a parser to refuse on behalf of.
//
// Two representations of one format — the TipTap schema and this — is the cost
// ADR-038 accepted. This file is the half that is testable without a browser.

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

// A widget instance's attributes: the stored widget name and its params
// (ADR-037 decisions 8 and 9 — the name is a stored identifier, and each input
// type has exactly one stored param shape). Taken from `MacroNode` rather than
// restated (invariant 5), then tightened: an unrecognised key inside a node we
// claim to understand is data we would drop on the next save without noticing,
// which is the whole failure mode. Here it is a parse error.
const WidgetAttrs = MacroNode.shape.attrs.strict();

// ADR-037 calls these widgets; the stored discriminator is `"macro"` and stays
// that way at v1. Every page ever written uses it, and v1 is *by definition*
// what those rows already contain — so making the AST say `"widget"` would
// reclassify every existing widget as an unknown node. Renaming the stored
// string is a v2 migration (the chain below is exactly where it goes), not a
// find-and-replace. ADR-038 decision 1 writes it as `"widget"`; that is the one
// place the ADR is ahead of the data.
export const PageWidgetNode = MacroNode.extend({ attrs: WidgetAttrs }).strict();
export type PageWidgetNode = z.infer<typeof PageWidgetNode>;

// Marks are open at the `type` level and closed in shape. StarterKit's set
// (bold/italic/strike/code) is not the interesting axis — losing a mark's attrs
// silently is — so the name is a string and the interior is parsed.
export const PageMark = z.object({
  type: z.string().min(1),
  attrs: z.record(z.unknown()).optional(),
}).strict();
export type PageMark = z.infer<typeof PageMark>;

export const PageTextNode = z.object({
  type: z.literal("text"),
  text: z.string(),
  marks: z.array(PageMark).optional(),
}).strict();
export type PageTextNode = z.infer<typeof PageTextNode>;

// ADR-038 decision 3. `raw` is the ORIGINAL value, held by reference and never
// re-encoded, so `serializePageDoc` can put it back exactly as it came in. This
// shape is in-memory only: no stored document contains a node of type
// `"unknown"`, and one that somehow did would be wrapped like any other
// unrecognised node and written back unchanged.
export const PageUnknownNode = z.object({
  type: z.literal("unknown"),
  raw: z.unknown(),
}).strict();
export type PageUnknownNode = z.infer<typeof PageUnknownNode>;

// Every node type this build knows, at any position. Position validity is a
// separate question, settled by the per-position unions below: a `text` node
// sitting where a block belongs is a KNOWN type in the wrong place, so it is a
// parse error, not an unknown node.
const KNOWN_NODE_TYPES: ReadonlySet<string> = new Set(["paragraph", "heading", "macro", "repeat", "text"]);

function isNodeLike(value: unknown): value is { type: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

// Carry, don't drop (decision 3): a node whose `type` this build does not know
// becomes `{ type: "unknown", raw }`.
//
// Note what deliberately does NOT come through here: a node whose type we DO
// know but whose interior is malformed — a heading at level 9, an unexpected
// key. Coercing that to `unknown` would freeze a broken node into the document
// permanently and call it forward compatibility. It is a parse error instead,
// and decision 4's read-only page is the right answer to a parse error.
function tagUnknownNode(raw: unknown): unknown {
  return isNodeLike(raw) && !KNOWN_NODE_TYPES.has(raw.type) ? { type: "unknown", raw } : raw;
}

export const PageInlineNode = z.preprocess(
  tagUnknownNode,
  z.discriminatedUnion("type", [PageTextNode, PageWidgetNode, PageUnknownNode]),
);
export type PageInlineNode = z.infer<typeof PageInlineNode>;

export const PageParagraphNode = z.object({
  type: z.literal("paragraph"),
  content: z.array(PageInlineNode).default([]),
}).strict();
export type PageParagraphNode = z.infer<typeof PageParagraphNode>;

// Levels 1-3, per ADR-038 decision 1. This is NARROWER than what the app can
// already produce: StarterKit allows 1-6 and the AI compose tool's block schema
// (`apps/web/src/server/ai/pageTools.ts`) accepts `level` 1-6 today. A stored
// level-4 heading therefore fails to parse here rather than becoming an unknown
// node. Pinned by a test so the discrepancy stays visible; widening it is an
// ADR amendment, not a quiet edit.
export const PageHeadingNode = z.object({
  type: z.literal("heading"),
  attrs: z.object({ level: z.union([z.literal(1), z.literal(2), z.literal(3)]) }).strict(),
  content: z.array(PageInlineNode).default([]),
}).strict();
export type PageHeadingNode = z.infer<typeof PageHeadingNode>;

// A repeater's `content` IS its row template, not its rendered rows (ADR-035
// decision 4, ADR-038 decision 1). Nothing writes one yet — M14 link 6 does —
// and that is the point: the format has to understand it before the editor
// does, or the first client to meet one eats the document.
export const PageRepeatNode = z.object({
  type: z.literal("repeat"),
  attrs: WidgetAttrs,
  content: z.array(PageInlineNode).default([]),
}).strict();
export type PageRepeatNode = z.infer<typeof PageRepeatNode>;

export const PageNode = z.preprocess(
  tagUnknownNode,
  z.discriminatedUnion("type", [PageParagraphNode, PageHeadingNode, PageWidgetNode, PageRepeatNode, PageUnknownNode]),
);
export type PageNode = z.infer<typeof PageNode>;

// ---------------------------------------------------------------------------
// The document and its version
// ---------------------------------------------------------------------------

// `v` defaults to 1 because existing rows have no `v` and are v1 *by
// definition* — ADR-038 decision 2, and the one inference this design permits.
// It is safe for exactly one reason: v1 is the only version that has ever
// existed. It stops being safe the moment a second version does, which is why
// the default lives here, in one place, next to the chain that would then have
// something to do.
export const PageDoc = z.object({
  v: z.number().int().positive().default(1),
  type: z.literal("doc"),
  content: z.array(PageNode).default([]),
}).strict();
export type PageDoc = z.infer<typeof PageDoc>;

export type PageDocMigration = (doc: PageDoc) => PageDoc;

// Ordered: index `i` takes a v(i+1) document to v(i+2). Empty, and that is not
// a stub — there is one version, so there is nothing to migrate. What is being
// built is the mechanism and its tests, so that the first real format change is
// an append with a fixture beside it.
//
// When v2 arrives, so does the part this cannot express: migrating a v1 row
// needs the *v1* schema to parse it, and `PageDoc` here is always the current
// one. That is the moment the node schemas split per version and this type
// becomes a per-step pair rather than `(PageDoc) => PageDoc`. Writing that
// generality now would be inventing a shape for a migration nobody has yet.
export const PAGE_DOC_MIGRATIONS: readonly PageDocMigration[] = [];

// Derived, never written twice: appending a migration IS the version bump.
export const CURRENT_PAGE_DOC_VERSION = PAGE_DOC_MIGRATIONS.length + 1;

// Migrate-on-read (decision 2). Idempotent by construction: a document already
// at the current version has an empty tail of migrations to apply.
//
// A document from the FUTURE is refused rather than guessed at. Decision 3 lets
// an older client survive newer *nodes*; a higher `v` means the shape of the
// document itself changed, and there is no rule by which this build could write
// it back safely. Refusing is what decision 4 does with the answer.
export function migratePageDoc(doc: PageDoc): PageDoc {
  if (doc.v > CURRENT_PAGE_DOC_VERSION) {
    throw new Error(
      `page document is v${doc.v}, but this build understands up to v${CURRENT_PAGE_DOC_VERSION}`,
    );
  }
  return PAGE_DOC_MIGRATIONS.slice(doc.v - 1).reduce<PageDoc>(
    (acc, step, index) => ({ ...step(acc), v: doc.v + index + 1 }),
    doc,
  );
}

export function parsePageDoc(raw: unknown): PageDoc {
  return migratePageDoc(PageDoc.parse(raw));
}

// ---------------------------------------------------------------------------
// Back to the wire
// ---------------------------------------------------------------------------

// An unknown node serialises to its `raw` and nothing else — byte-identical,
// which is the property ADR-038 decision 3 actually promises and the one worth
// testing hardest. Known nodes serialise CANONICALLY (schema key order, `v`
// present, absent `content` materialised as `[]`), so the whole document is not
// byte-stable across a round trip and was never meant to be.
function serializePageInlineNode(node: PageInlineNode): unknown {
  return node.type === "unknown" ? node.raw : node;
}

export function serializePageNode(node: PageNode): unknown {
  switch (node.type) {
    case "unknown":
      return node.raw;
    case "macro":
      return node;
    case "paragraph":
    case "heading":
    case "repeat":
      return { ...node, content: node.content.map(serializePageInlineNode) };
  }
}

export function serializePageDoc(doc: PageDoc): unknown {
  return { v: doc.v, type: doc.type, content: doc.content.map(serializePageNode) };
}
