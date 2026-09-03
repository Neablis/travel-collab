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
//
// The vocabulary below is MEASURED against the other half, not read off the
// ADR: an editor built with `PageEditor`'s own extension set (`StarterKit` +
// `MacroNodeExtension`) was fed one of every node and its `getJSON()` and
// `schema.nodes` read back (2026-09-03). Every attr, every default and every
// block/inline classification here came from that. Re-measure before changing
// one; ADR-038 decision 1's list was written from neither and was wrong twice.

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

// A line break inside a paragraph. INLINE, not a block: measured
// `schema.nodes.hardBreak.isInline === true`, group `"inline"`, and `<p>a<br>b`
// emits it between the two text nodes. It is a leaf and carries no attrs at
// all — ProseMirror omits the `attrs` key entirely for a node type that
// declares none, so `.strict()` here is what the editor actually writes.
export const PageHardBreakNode = z.object({ type: z.literal("hardBreak") }).strict();
export type PageHardBreakNode = z.infer<typeof PageHardBreakNode>;

// Same story as `hardBreak`, one level up: a block-position leaf with no attrs.
export const PageHorizontalRuleNode = z.object({ type: z.literal("horizontalRule") }).strict();
export type PageHorizontalRuleNode = z.infer<typeof PageHorizontalRuleNode>;

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
// parse error, not an unknown node. `listItem` is the sharpest case — measured,
// it has no ProseMirror group, so the editor accepts it inside a list and
// nowhere else, and this file says the same.
//
// What this does NOT reproduce is ProseMirror's full content expressions —
// `listItem`'s `paragraph block*` requires its FIRST child to be a paragraph,
// and nothing here enforces the ordering. Vocabulary and position are what a
// document can be wrong about in a way that loses data; child ordering is
// something the editor repairs on its own.
const KNOWN_NODE_TYPES: ReadonlySet<string> = new Set([
  "paragraph",
  "heading",
  "macro",
  "repeat",
  "text",
  "blockquote",
  "bulletList",
  "orderedList",
  "listItem",
  "codeBlock",
  "horizontalRule",
  "hardBreak",
]);

function isNodeLike(value: unknown): value is { type: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

// Carry, don't drop (decision 3): a node whose `type` this build does not know
// becomes `{ type: "unknown", raw }`. Applied at EVERY content position, list
// items and code-block text included — a rolling deploy does not get to choose
// where the newer node lands.
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
  z.discriminatedUnion("type", [PageTextNode, PageWidgetNode, PageHardBreakNode, PageUnknownNode]),
);
export type PageInlineNode = z.infer<typeof PageInlineNode>;

export const PageParagraphNode = z.object({
  type: z.literal("paragraph"),
  content: z.array(PageInlineNode).default([]),
}).strict();
export type PageParagraphNode = z.infer<typeof PageParagraphNode>;

// Levels 1-6: StarterKit's own range (measured — `<h1>`…`<h6>` all round-trip
// as `heading` with the matching `level`), and the same range the AI compose
// tool's block schema accepts (`apps/web/src/server/ai/pageTools.ts:37`,
// `z.number().int().min(1).max(6)`). ADR-038 decision 1 says 1-3; Mitchell
// chose widening the AST over narrowing the tool (2026-09-03), because a
// level-4 heading is reachable from both the editor and `/ask` today and a
// document containing one would otherwise open read-only under decision 4.
export const PageHeadingNode = z.object({
  type: z.literal("heading"),
  attrs: z.object({
    level: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
      z.literal(6),
    ]),
  }).strict(),
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

// A code block holds text and NOTHING ELSE — measured
// `schema.nodes.codeBlock.spec.marks === ""`, which is ProseMirror for "no
// marks here", so bold inside a code block is not a thing the editor can
// write. A stored code block carrying marked text did not come from the
// editor, and treating it as valid would mean re-serialising a mark the editor
// drops on the next keystroke.
export const PageCodeTextNode = z.object({
  type: z.literal("text"),
  text: z.string(),
}).strict();
export type PageCodeTextNode = z.infer<typeof PageCodeTextNode>;

const PageCodeBlockContentNode = z.preprocess(
  tagUnknownNode,
  z.discriminatedUnion("type", [PageCodeTextNode, PageUnknownNode]),
);

// `language` is `null` when the block has no language set — that is TipTap's
// own default, not an absence we invented, so an attrs-less code block
// materialises to it rather than failing to parse. Same reasoning as
// `content`'s `.default([])`; contrast `heading.attrs.level`, which carries
// meaning and has no defensible default.
export const PageCodeBlockNode = z.object({
  type: z.literal("codeBlock"),
  attrs: z.object({ language: z.string().nullable() }).strict().default({ language: null }),
  content: z.array(PageCodeBlockContentNode).default([]),
}).strict();
export type PageCodeBlockNode = z.infer<typeof PageCodeBlockNode>;

// ---------------------------------------------------------------------------
// The recursive part of the vocabulary
// ---------------------------------------------------------------------------

// Lists and blockquotes hold blocks, so the union refers to itself:
// `bulletList → listItem → paragraph`, and a blockquote can hold either. Zod
// cannot infer a recursive type, so these four shapes are the one place in this
// file where a type is written by hand rather than derived. They are not free
// duplication: `PageNode`'s schema is annotated with the hand-written type
// below, so a schema that stops matching its type fails to compile.
export interface PageListItemNode {
  type: "listItem";
  content: PageNode[];
}

// A list holds list items — and, per decision 3, whatever a newer build put
// there instead. A `paragraph` directly inside a `bulletList` is a known type
// in a position the editor cannot produce, so it stays a parse error.
export type PageListContentNode = PageListItemNode | PageUnknownNode;

export interface PageBulletListNode {
  type: "bulletList";
  content: PageListContentNode[];
}

export interface PageOrderedListNode {
  type: "orderedList";
  attrs: { start: number; type: string | null };
  content: PageListContentNode[];
}

export interface PageBlockquoteNode {
  type: "blockquote";
  content: PageNode[];
}

export type PageNode =
  | PageParagraphNode
  | PageHeadingNode
  | PageWidgetNode
  | PageRepeatNode
  | PageCodeBlockNode
  | PageHorizontalRuleNode
  | PageBlockquoteNode
  | PageBulletListNode
  | PageOrderedListNode
  | PageUnknownNode;

// The knot-tying reference. The annotation is what stops TypeScript's
// "referenced directly or indirectly in its own initializer"; the `unknown`
// input parameter is required because `z.preprocess` accepts anything.
const NestedPageNode: z.ZodType<PageNode, z.ZodTypeDef, unknown> = z.lazy(() => PageNode);

export const PageListItemNode = z.object({
  type: z.literal("listItem"),
  content: z.array(NestedPageNode).default([]),
}).strict();

const PageListContentNode = z.preprocess(
  tagUnknownNode,
  z.discriminatedUnion("type", [PageListItemNode, PageUnknownNode]),
);

export const PageBulletListNode = z.object({
  type: z.literal("bulletList"),
  content: z.array(PageListContentNode).default([]),
}).strict();

// `start` and `type` are the `<ol>` attributes, and both are always emitted:
// measured `{ start: 1, type: null }` for a plain list and `{ start: 3, type:
// null }` for `<ol start="3">`. `type` is the list-style marker
// ("1"/"a"/"A"/"i"/"I"), left as a string rather than an enum — an
// unrecognised marker is not worth making a page read-only over, and the
// editor offers no way to set one today.
export const PageOrderedListNode = z.object({
  type: z.literal("orderedList"),
  attrs: z.object({
    start: z.number().int(),
    type: z.string().nullable(),
  }).strict().default({ start: 1, type: null }),
  content: z.array(PageListContentNode).default([]),
}).strict();

export const PageBlockquoteNode = z.object({
  type: z.literal("blockquote"),
  content: z.array(NestedPageNode).default([]),
}).strict();

export const PageNode: z.ZodType<PageNode, z.ZodTypeDef, unknown> = z.preprocess(
  tagUnknownNode,
  z.discriminatedUnion("type", [
    PageParagraphNode,
    PageHeadingNode,
    PageWidgetNode,
    PageRepeatNode,
    PageCodeBlockNode,
    PageHorizontalRuleNode,
    PageBlockquoteNode,
    PageBulletListNode,
    PageOrderedListNode,
    PageUnknownNode,
  ]),
);

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
//
// Every leaf position goes through this one: inline nodes and code-block text
// are all leaves, and a code text node is a text node with fewer keys.
function serializePageInlineNode(node: PageInlineNode): unknown {
  return node.type === "unknown" ? node.raw : node;
}

function serializePageListContentNode(node: PageListContentNode): unknown {
  return node.type === "unknown"
    ? node.raw
    : { ...node, content: node.content.map(serializePageNode) };
}

// Recursive, and that is the whole point: a list nested two deep whose
// serialiser only walked one level would round-trip lossily and silently, in
// the one function decision 4's guard depends on being right.
export function serializePageNode(node: PageNode): unknown {
  switch (node.type) {
    case "unknown":
      return node.raw;
    case "macro":
    case "horizontalRule":
      return node;
    case "paragraph":
    case "heading":
    case "repeat":
    case "codeBlock":
      return { ...node, content: node.content.map(serializePageInlineNode) };
    case "blockquote":
      return { ...node, content: node.content.map(serializePageNode) };
    case "bulletList":
    case "orderedList":
      return { ...node, content: node.content.map(serializePageListContentNode) };
  }
}

export function serializePageDoc(doc: PageDoc): unknown {
  return { v: doc.v, type: doc.type, content: doc.content.map(serializePageNode) };
}
