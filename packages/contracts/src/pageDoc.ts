import { z } from "zod";
import { buildAttributeManifest } from "./manifest.ts";
import {
  REPEAT_SCOPES,
  SENTENCE_TEMPLATE_MAX,
  escapeSentenceText,
  parseSentenceTemplate,
  repeatScopeOf,
  serializeSentenceTemplate,
  type RepeatScope,
  type SentencePart,
} from "./sentenceTemplate.ts";

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

// Macro params are an open bag validated per-macro by the registry (Wave 2).
// The contract only guarantees the node shape; the registry owns param schemas.
//
// This lived in `pages.ts` until the write-side inputs there started needing
// `PageDoc`, which made the two files import each other — a cycle that Zod
// schemas, built at module load rather than deferred behind a function, do not
// survive. It belongs here anyway: it IS the AST's widget node, and
// `PageWidgetNode` immediately below is built from it.
export const MacroNode = z.object({
  type: z.literal("macro"),
  attrs: z.object({
    name: z.string().min(1),
    params: z.record(z.unknown()).default({}),
  }),
});
export type MacroNode = z.infer<typeof MacroNode>;

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

// An authored repeat: one sentence printed once per day, stop or city (ADR-035
// decision 4). `attrs.name` names the rows widget whose selection it repeats
// over (`day.rows`, `stop.rows`, `city.rows` — `REPEAT_SCOPES`), and `params`
// are that widget's filters plus `template`, the sentence itself
// (`sentenceTemplate.ts`). `@tc/pages`' `insertRepeat` enforces that, not a
// narrower schema here, since the registry owns params (as for `macro`).
//
// **`content` is empty from v3 on.** Until then it held the template as inline
// text and widgets; Mitchell's preview comment on PR #221 (2026-09-24) made the
// sentence one string edited in the settings panel, and the v2 → v3 step below
// moves every stored template into `params.template`. The field stays in the
// schema because a v2 row is parsed BEFORE it is migrated, and the write check
// refuses a repeat that still carries content.
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

// ---------------------------------------------------------------------------
// v1 → v2: the seventeen widget names become eleven primitives (ADR-039)
// ---------------------------------------------------------------------------

/**
 * How one stored widget name becomes a primitive and its filters.
 *
 * ADR-039 decision 9, *"one migration, once"*: a document stores the primitive
 * and its filters, and a preset — the thing a person picks in the picker — is
 * data that is never stored. So retiring or renaming a preset migrates nothing,
 * and this table is the only migration the vocabulary change costs.
 *
 * - `name` is the primitive the old name becomes.
 * - `rename` maps the old param keys to the dimension names the primitive
 *   declares. `cost.day` spelled its binding `dayRef`; `cost` spells it `day`,
 *   which is what the spec's own table writes (`cost{day: N}`). **The VALUE is
 *   carried across untouched** — a `DayRef` is a `DayRef` under either key — so
 *   a page bound to day 3 is still bound to day 3 afterwards.
 * - `set` adds the filters the old NAME carried implicitly. "A line for every
 *   booking" was a widget; it is `stop.rows` with `kind: "booked"` now, and
 *   that constant is the whole of what the name used to mean.
 *
 * **Why this lives in `packages/contracts` rather than beside the registry.**
 * It is a rewrite of stored documents, which is this file's subject, and
 * `packages/contracts` may not import `@tc/pages`. The preset table in
 * `@tc/pages` carries the human copy (titles, keywords) and declares which old
 * name each preset replaces by reading THIS map, so the mapping has one home;
 * `presets.test.ts` asserts every entry here lands on a primitive that exists
 * with params that primitive accepts, which is the check an import would have
 * given for free.
 */
export interface WidgetNameMigration {
  name: string;
  rename?: Readonly<Record<string, string>>;
  set?: Readonly<Record<string, unknown>>;
}

export const WIDGET_NAME_MIGRATION: Readonly<Record<string, WidgetNameMigration>> = {
  // `attribute` over an allow-listed field (decision 6). Four widgets that each
  // read one field become one primitive told which field to read.
  "trip.name": { name: "attribute", set: { field: "trip.name" } },
  "budget.remaining": { name: "attribute", set: { field: "trip.budgetRemaining" } },
  "account.name": { name: "attribute", set: { field: "account.name" } },
  "account.homeAirport": { name: "attribute", set: { field: "account.homeAirport" } },

  // The four pairs ADR-039 opens with: the same widget written twice, differing
  // only by whether a filter is set. Each pair collapses onto one primitive,
  // and the member that carried a binding keeps it.
  "trip.dates": { name: "dates" },
  "day.date": { name: "dates", rename: { dayRef: "day" } },
  "cost.trip": { name: "cost" },
  "cost.day": { name: "cost", rename: { dayRef: "day" } },
  "itinerary.trip": { name: "day.detail" },
  "itinerary.day": { name: "day.detail", rename: { dayRef: "day" } },
  "stop.line": { name: "stop.rows", rename: { dayRef: "day" } },
  "booking.line": { name: "stop.rows", rename: { dayRef: "day" }, set: { kind: "booked" } },

  // The rest: a rename, and in two cases a dimension that used to be the name.
  "day.city": { name: "city", rename: { dayRef: "day" } },
  "day.window": { name: "hours", rename: { dayRef: "day" } },
  "day.line": { name: "day.rows" },
  "city.line": { name: "city.rows" },
  "costs.table": { name: "cost.rows" },
};

// Rewrite one widget node's attrs. Unknown names are left ALONE rather than
// dropped: a name this build does not recognise is either a widget from a newer
// build (decision 3's carry-don't-drop, applied to a name instead of a node
// type) or one already migrated, and `MacroView` has a legible answer for a
// name the registry cannot resolve. Rewriting it to something would be guessing.
function migrateWidgetAttrs(attrs: PageWidgetNode["attrs"]): PageWidgetNode["attrs"] {
  const step = WIDGET_NAME_MIGRATION[attrs.name];
  if (!step) return attrs;
  const rename = step.rename ?? {};

  // **Two passes, and the order is the whole point.** A single pass writing
  // `params[rename[key] ?? key] = value` is at the mercy of JSON property
  // order: a hand-edited v1 node carrying BOTH `{ dayRef: day2, day: day5 }`
  // migrates to day 2 or day 5 depending on which key Zod happened to iterate
  // last (Copilot, PR 141). Only `dayRef` meant anything at v1 — `day` was a
  // param the old resolver ignored — so the renamed key has to win every time,
  // not most of the time.
  const params: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attrs.params)) {
    if (!(key in rename)) params[key] = value;
  }
  for (const [from, to] of Object.entries(rename)) {
    if (from in attrs.params) params[to] = attrs.params[from];
  }

  // `set` last, so the filter the NAME carried wins over a stray param of the
  // same key in a hand-edited document. `booking.line` means booked; a
  // `kind: "idea"` sitting in its params meant nothing to the old resolver and
  // must not start meaning something now.
  return { name: step.name, params: { ...params, ...step.set } };
}

// How a step rewrites one widget: new attrs, or a text node to stand where the
// widget was (a removed field, below).
type WidgetRewrite = (attrs: PageWidgetNode["attrs"]) => PageWidgetNode["attrs"] | PageTextNode;

// A step that rewrites widget nodes at every depth and touches nothing else.
// Both kinds of step below are one of these.
//
// **The node SHAPE is unchanged, which is what makes this expressible as
// `(PageDoc) => PageDoc`.** The comment this replaces warned that a real
// migration would need the v1 schema to parse a v1 row while `PageDoc` is
// always the current one. That is true of a migration that changes the
// vocabulary of nodes or attrs; these change only the STRING in `attrs.name`
// and the KEYS and VALUES in `attrs.params`, all of which the current schema
// already accepts (`name` is any non-empty string, `params` any record), and a
// replacement is built from nodes the current schema already has. The day the
// format changes shape, the split that comment describes is still owed.
function rewriteWidgets(rewrite: WidgetRewrite): PageDocMigration {
  const inline = (node: PageInlineNode): PageInlineNode => {
    if (node.type !== "macro") return node;
    const next = rewrite(node.attrs);
    return "type" in next ? next : { ...node, attrs: next };
  };
  // A text node is not a block, so a replaced block widget is a paragraph —
  // and a replaced repeat keeps its row template after the text, because what
  // the author wrote there is theirs, not the field's.
  const block = (node: PageNode): PageNode => {
    switch (node.type) {
      case "macro": {
        const next = rewrite(node.attrs);
        return "type" in next ? { type: "paragraph", content: [next] } : { ...node, attrs: next };
      }
      case "repeat": {
        const next = rewrite(node.attrs);
        const content = node.content.map(inline);
        return "type" in next
          ? { type: "paragraph", content: [next, ...content] }
          : { ...node, attrs: next, content };
      }
      case "paragraph":
      case "heading":
        return { ...node, content: node.content.map(inline) };
      case "blockquote":
        return { ...node, content: node.content.map(block) };
      case "bulletList":
      case "orderedList":
        return {
          ...node,
          content: node.content.map((item) =>
            item.type === "unknown" ? item : { ...item, content: item.content.map(block) },
          ),
        } as PageNode;
      // A code block holds text, a horizontal rule holds nothing, and an unknown
      // node is carried BYTE-IDENTICALLY (decision 3) — rewriting inside one
      // would be editing a document we admitted we cannot read.
      case "codeBlock":
      case "horizontalRule":
      case "unknown":
        return node;
    }
  };
  return (doc) => ({ ...doc, content: doc.content.map(block) });
}

// The v1 → v2 step.
const migrateWidgetNames = rewriteWidgets(migrateWidgetAttrs);

// ---------------------------------------------------------------------------
// v2 → v3: a repeat's sentence becomes a template param (PR #221 preview)
// ---------------------------------------------------------------------------

// The label a template widget becomes when no token can stand in for it:
// every widget name the registry held when repeats carried widgets. Frozen
// here, because a migration is a function of the past — no v2 template can
// name a widget added after this step shipped.
const V2_WIDGET_TITLES: Readonly<Record<string, string>> = {
  cost: "What it costs",
  count: "How many",
  dates: "The dates",
  hours: "Start and end times",
  city: "The cities",
  attribute: "One fact",
  "day.detail": "The days in detail",
  "city.detail": "The cities in detail",
  "day.rows": "A line for every day",
  "city.rows": "A line for every city",
  "stop.rows": "A line for every stop",
  "cost.rows": "Costs, broken down",
  open: "What needs you",
  "country.facts": "Know before you go",
  "trip.strip": "Trip strip",
  "cost.chart": "Spend by day",
  field: "A detail of the stops",
  "day.sun": "Sunrise and sunset",
  "day.fromHome": "Time difference from home",
  "day.weather": "Weather",
};

// The manifest's label for a stored field path, or `undefined` for a path it
// does not publish.
function manifestLabel(path: string): string | undefined {
  for (const entry of buildAttributeManifest()) {
    if (entry.kind === "value" && `${entry.object}.${entry.field}` === path) return entry.label;
    if (entry.kind === "collection") {
      const field = entry.fields.find((f) => `${entry.object}.${entry.collection}.${f.field}` === path);
      if (field) return field.label;
    }
  }
  return undefined;
}

/**
 * The token a v2 template widget becomes in a repeat over `scope`, or `null`
 * when none prints what it printed.
 *
 * Only a widget with NO filter of its own qualifies: in a v2 template an
 * unbound widget read the line's item, so `city{}` in a sentence for every city
 * printed that city — exactly `{name}`. `cost{kind: "booked"}` in a day's
 * sentence printed the day's booked cost, which no day field holds, so it is a
 * label instead. Exported for `@tc/pages`' test that every key here is one its
 * resolver knows.
 */
export function v2WidgetToken(scope: RepeatScope, attrs: PageWidgetNode["attrs"]): string | null {
  const keys = Object.keys(attrs.params);
  const bare = keys.length === 0;
  switch (scope) {
    case "stop": {
      const field = attrs.params.field;
      if (attrs.name === "field" && keys.length === 1 && typeof field === "string" && field.startsWith("stop.")) {
        return manifestLabel(field) === undefined ? null : field.slice("stop.".length);
      }
      return attrs.name === "cost" && bare ? "cost" : null;
    }
    case "day":
      if (!bare) return null;
      return attrs.name === "dates" ? "date" : attrs.name === "city" ? "cities" : attrs.name === "cost" ? "costSubtotal" : null;
    case "city":
      return bare && attrs.name === "city" ? "name" : null;
  }
}

function v2WidgetLabel(attrs: PageWidgetNode["attrs"]): string {
  const field = attrs.params.field;
  const fromField = typeof field === "string" ? manifestLabel(field) : undefined;
  return fromField ?? V2_WIDGET_TITLES[attrs.name] ?? "a widget";
}

// A v2 template, written as the one-line sentence that reads the same: text as
// text (marks are formatting and go), a line break as a space, a widget as its
// token or its label, and a node from a newer build — which printed nothing on
// a line — as nothing.
function v2TemplateOf(scope: RepeatScope | null, content: readonly PageInlineNode[]): string {
  const written = content
    .map((node) => {
      switch (node.type) {
        case "text":
          // A text node may hold a line break (the API and the assistant write
          // them); a sentence may not, and a template that fails its schema
          // would refuse every later save of the page (PR #221 self-review).
          return escapeSentenceText(node.text.replace(/\r\n|\r|\n/g, " "));
        case "hardBreak":
          return " ";
        case "macro": {
          const token = scope === null ? null : v2WidgetToken(scope, node.attrs);
          return token === null ? escapeSentenceText(v2WidgetLabel(node.attrs)) : `{${token}}`;
        }
        default:
          return "";
      }
    })
    .join("");
  return written.slice(0, SENTENCE_TEMPLATE_MAX);
}

// Every block, at every depth, through `rewrite`. Repeats are blocks, so one
// can sit in a list item or a quote as well as at the top.
function rewriteBlocks(rewrite: (node: PageNode) => PageNode): PageDocMigration {
  const block = (node: PageNode): PageNode => {
    const next = rewrite(node);
    switch (next.type) {
      case "blockquote":
        return { ...next, content: next.content.map(block) };
      case "bulletList":
      case "orderedList":
        return {
          ...next,
          content: next.content.map((item) =>
            item.type === "unknown" ? item : { ...item, content: item.content.map(block) },
          ),
        } as PageNode;
      default:
        return next;
    }
  };
  return (doc) => ({ ...doc, content: doc.content.map(block) });
}

// The v2 → v3 step. A repeat with no content is left as it is: it had no
// sentence, and inventing an empty `template` would only add a key.
const migrateRepeatTemplates = rewriteBlocks((node) => {
  if (node.type !== "repeat" || node.content.length === 0) return node;
  const template = v2TemplateOf(repeatScopeOf(node.attrs.name), node.content);
  return { ...node, attrs: { ...node.attrs, params: { ...node.attrs.params, template } }, content: [] };
});

// ---------------------------------------------------------------------------
// v4 onward: a field is renamed or removed (M14 field widget, answer 1)
// ---------------------------------------------------------------------------

/**
 * One deliberate change to a published manifest field, which converts every
 * stored document that names it — so a stored page never names a field the
 * manifest lacks, and `writeCheck`'s whole-document refusal (the field-widget
 * review's gap 1) cannot be reached by a planned change.
 *
 * Paths are the strings a widget stores, `object.field` (or
 * `object.collection.field` for a collection member): `"trip.name"`,
 * `"stop.cost"`.
 *
 * - `rename`: every widget reading `from` reads `to` afterwards.
 * - `remove`: every widget reading `path` becomes a line of plain text naming
 *   it by `label` — Mitchell's call (four more calls, item 4), so a reader sees
 *   that something was there. The label is carried here because the manifest
 *   that held it no longer does.
 * - `since`: the document version this change produces. See `FIELD_CHANGES`.
 */
export type FieldChange =
  | { kind: "rename"; from: string; to: string; since: number }
  | { kind: "remove"; path: string; label: string; since: number };

/**
 * Every field rename and removal ever made, oldest first. Empty: no published
 * field has been renamed or removed yet.
 *
 * **The versioning rule.** Each distinct `since` is ONE new document version,
 * however many entries share it, so a change of any size is a one-line entry
 * per field and bumps `CURRENT_PAGE_DOC_VERSION` exactly once. A new batch
 * takes `since: CURRENT_PAGE_DOC_VERSION + 1`, and `pageDocMigrations` refuses
 * a table whose batches do not run on without a gap. A batch that has merged
 * is closed: a v3 document never runs the v3 step again, so an entry added to
 * it later would reach only documents older than v3.
 *
 * `manifest.test.ts` fails when a published field disappears without an entry
 * here, and when an entry names a field that does not add up (a rename to
 * nothing, a removal of a field still published).
 */
export const FIELD_CHANGES: readonly FieldChange[] = [];

/**
 * The widget params that hold a manifest path, and how many. `attribute` and
 * the field widget store one `field`; `stop.rows` stores a list of `columns`.
 * A path under any other key has to be added here, or its widgets will not
 * convert.
 *
 * A removed field in a `list` param drops out of the list rather than
 * replacing the widget: a column is not a widget, and the table still holds
 * every other column the author chose.
 */
const FIELD_PARAMS: Readonly<Record<string, "one" | "list">> = { field: "one", columns: "list" };

function placeholder(label: string): PageTextNode {
  return { type: "text", text: `(${label} — no longer available)` };
}

// Where one path ends up after a batch: a new path, or the label it was removed under.
// Entries apply in table order, so a batch can rename a field and then remove
// what it was renamed to.
function applyBatch(batch: readonly FieldChange[], path: string): { path: string } | { removed: string } {
  for (const change of batch) {
    if (change.kind === "remove" && change.path === path) return { removed: change.label };
    if (change.kind === "rename" && change.from === path) path = change.to;
  }
  return { path };
}

function fieldChangeStep(batch: readonly FieldChange[]): PageDocMigration {
  return rewriteWidgets((attrs) => {
    const params = { ...attrs.params };
    for (const [key, arity] of Object.entries(FIELD_PARAMS)) {
      const value = params[key];
      if (arity === "one" && typeof value === "string") {
        const next = applyBatch(batch, value);
        if ("removed" in next) return placeholder(next.removed);
        params[key] = next.path;
      }
      if (arity === "list" && Array.isArray(value)) {
        params[key] = value.flatMap((item: unknown) => {
          if (typeof item !== "string") return [item];
          const next = applyBatch(batch, item);
          return "removed" in next ? [] : [next.path];
        });
      }
    }
    const template = params.template;
    const scope = repeatScopeOf(attrs.name);
    if (scope !== null && typeof template === "string") params.template = retokenize(batch, scope, template);
    return { ...attrs, params };
  });
}

// A repeat's sentence names fields by token, so a renamed field renames its
// token and a removed one becomes its label as plain text — the sentence
// version of the widget's placeholder. Rewritten only when a token moved, so a
// sentence this batch does not touch keeps its exact spelling.
function retokenize(batch: readonly FieldChange[], scope: RepeatScope, template: string): string {
  const { prefix } = REPEAT_SCOPES[scope];
  let changed = false;
  const parts = parseSentenceTemplate(template).map((part): SentencePart => {
    if (!("field" in part)) return part;
    const next = applyBatch(batch, prefix + part.field);
    if ("removed" in next) {
      changed = true;
      return { text: next.removed };
    }
    if (next.path === prefix + part.field) return part;
    changed = true;
    // Moved out of this item's fields: no token can reach it, so it reads as a
    // removed field does, as its label (PR #221 self-review).
    if (!next.path.startsWith(prefix)) return { text: manifestLabel(next.path) ?? part.field };
    return { field: next.path.slice(prefix.length) };
  });
  return changed ? serializeSentenceTemplate(parts) : template;
}

// The steps that come before any field change. A future step that is not a
// field change goes here too, and the next field batch's `since` moves past it.
const BASE_MIGRATIONS: readonly PageDocMigration[] = [migrateWidgetNames, migrateRepeatTemplates];

/**
 * The migration chain for a given field-change table. The real chain is
 * `pageDocMigrations(FIELD_CHANGES)`; a test passes its own table, so the
 * conversion is exercised while the real one is empty.
 */
export function pageDocMigrations(changes: readonly FieldChange[]): PageDocMigration[] {
  const first = BASE_MIGRATIONS.length + 2;
  const versions = [...new Set(changes.map((change) => change.since))].sort((a, b) => a - b);
  versions.forEach((version, index) => {
    if (version !== first + index) {
      throw new Error(
        `FIELD_CHANGES batches must run on from since ${first} with no gap; found since ${version}`,
      );
    }
  });
  return [
    ...BASE_MIGRATIONS,
    ...versions.map((version) => fieldChangeStep(changes.filter((change) => change.since === version))),
  ];
}

// Ordered: index `i` takes a v(i+1) document to v(i+2).
export const PAGE_DOC_MIGRATIONS: readonly PageDocMigration[] = pageDocMigrations(FIELD_CHANGES);

// Derived, never written twice: appending a migration IS the version bump.
export const CURRENT_PAGE_DOC_VERSION = PAGE_DOC_MIGRATIONS.length + 1;

// Build a document at the CURRENT version. Every producer of a new page —
// the template seeder, the "new notebook" button, the AI compose tool — goes
// through this rather than writing `v: 1` inline, for the same reason
// `CURRENT_PAGE_DOC_VERSION` is derived: the day a v2 exists, a hard-coded 1
// scattered across four files is four places to write a stale version from,
// and each one produces a document that claims to need a migration it does
// not need.
export function newPageDoc(content: PageNode[] = []): PageDoc {
  return { v: CURRENT_PAGE_DOC_VERSION, type: "doc", content };
}

// Migrate-on-read (decision 2). Idempotent by construction: a document already
// at the current version has an empty tail of migrations to apply.
//
// A document from the FUTURE is refused rather than guessed at. Decision 3 lets
// an older client survive newer *nodes*; a higher `v` means the shape of the
// document itself changed, and there is no rule by which this build could write
// it back safely. Refusing is what decision 4 does with the answer.
//
// `migrations` is for tests (see `pageDocMigrations`); every caller in the
// product migrates to the real chain.
export function migratePageDoc(
  doc: PageDoc,
  migrations: readonly PageDocMigration[] = PAGE_DOC_MIGRATIONS,
): PageDoc {
  const current = migrations.length + 1;
  if (doc.v > current) {
    throw new Error(`page document is v${doc.v}, but this build understands up to v${current}`);
  }
  return migrations.slice(doc.v - 1).reduce<PageDoc>(
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
    default: {
      // The enforcement, not defensive code (KI-2026-09-05-h). The return type
      // is `unknown` and the repo does not set `noImplicitReturns`, so without
      // this a `PageNode` member with no case compiles, serialises as
      // `undefined`, is stored as `null`, and fails `isNodeLike` on the next
      // read, which leaves the page unreadable. No test can catch that: the
      // goldens are fixed and the round-trip generator only makes unknown types.
      const exhaustive: never = node;
      return exhaustive;
    }
  }
}

export function serializePageDoc(doc: PageDoc): unknown {
  return { v: doc.v, type: doc.type, content: doc.content.map(serializePageNode) };
}

// ---------------------------------------------------------------------------
// The vocabulary a document actually uses
// ---------------------------------------------------------------------------

// Every node type name present in a parsed document, at any depth.
//
// This exists because ADR-038 decision 4's stated criterion — "parse the stored
// document and re-serialise it; if the result is not equivalent to what was
// stored, open read-only" — is BLIND to the failure it was written to prevent.
// Measured 2026-09-03, both cases:
//
//   * a `repeat` node is a KNOWN type here and has no TipTap extension, so it
//     parses, round-trips BYTE-IDENTICALLY, and is discarded by the editor;
//   * an unknown node round-trips byte-identically too, because that is exactly
//     what decision 3 promises it will do.
//
// So round-tripping proves the document survives *our* parser. It says nothing
// about whether the *editor* can mount it, and the editor is what eats the
// page. The real question is a vocabulary comparison across the two
// representations ADR-038 accepted the cost of keeping in step, and this is the
// half of it contracts can answer without importing TipTap.
//
// An `unknown` node reports the type it was WRAPPING, not the string
// `"unknown"`: the caller is asking "what is in this document that I might not
// be able to render", and `{ type: "unknown" }` is our word for the answer, not
// the answer.
export function collectPageDocNodeTypes(doc: PageDoc): ReadonlySet<string> {
  const types = new Set<string>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!isNodeLike(node)) return;
    if (node.type === "unknown") {
      const raw = (node as PageUnknownNode).raw;
      // A wrapped node always has a string `type` — `tagUnknownNode` only wraps
      // things `isNodeLike` accepted — but `raw` is typed `unknown`, so this
      // reads it back defensively rather than asserting.
      types.add(isNodeLike(raw) ? raw.type : "unknown");
      return;
    }
    types.add(node.type);
    visit((node as { content?: unknown }).content);
  };
  visit(doc.content);
  return types;
}
