import {
  PageDoc as PageDocSchema,
  migratePageDoc,
  type PageContext,
  type PageDoc,
  type PageInlineNode,
  type PageNode,
  type PageWidgetNode,
} from "@tc/contracts";

/**
 * The day id a template writes where the source trip's day id was — a pin to a
 * day this trip does not have.
 *
 * **Why a tombstone, and not dropping the binding.** An ABSENT `day` means
 * every day (ADR-039 decision 2), so deleting the param would silently widen a
 * widget about one day into a widget about the whole trip — the confident wrong
 * answer `dayIndexOf` exists to refuse. A `dayId` that names no day is already
 * a state every reader handles: the resolvers answer `unbound("day")`, which
 * `MacroView` renders as *"that day was removed"* (actionable in Editing), and
 * the day control reads it as stale and clearable. The nil UUID names no day in
 * any trip — day ids are v4 and minted fresh — so the binding stays a binding,
 * aimed at nothing, and carries no other trip's id.
 */
export const UNRESOLVED_DAY_ID = "00000000-0000-0000-0000-000000000000";

/** What a template becomes in a trip: the page's context and document, or why it cannot. */
export type TemplateInstance =
  | { ok: true; context: PageContext; content: PageDoc }
  | { ok: false; message: string };

/**
 * A saved notebook's snapshot, made into a document for `target` (M14 link 10).
 *
 * Three steps, in this order, and each is a rule rather than a convenience:
 *
 * 1. **Parse strictly, then migrate** (ADR-038 decision 2). The snapshot keeps
 *    the version it was taken at; a template saved at v1 is instantiated after
 *    the AST has moved, so it is carried forward by the same chain every stored
 *    page reads through. A snapshot from a NEWER build is refused, as
 *    `migratePageDoc` refuses any document it has no rule to write back.
 * 2. **Re-bind days to the target trip.** The one param value that names a
 *    trip's own row is a `DayRef` of kind `dayId`. One that names a day of the
 *    target trip is kept (a template re-used in the trip it came from); any
 *    other is re-pointed at `UNRESOLVED_DAY_ID`, so the source trip's ids never
 *    reach the target's event stream. `index` refs are positions, so they carry
 *    over as written — "Day 3" is Day 3 of whichever trip — and one past the
 *    end is already `unbound("day")` without help. City names, tags, kinds and
 *    date ranges are values rather than ids and are carried as written: a city
 *    the new trip does not touch matches nothing, and a range is shown in its
 *    control, where it can be changed. Nothing is guessed.
 * 3. **The context is the target trip and nothing else.** `kind: "overview"`
 *    is dropped: a trip has exactly one Overview (SPEC §25), and a template
 *    saved FROM one must instantiate as an ordinary notebook, not a second
 *    undeletable page.
 *
 * Pure (Invariant 4): the caller mints the page id and runs the command.
 */
export function instantiateTemplate(
  snapshot: unknown,
  target: { tripId: string; dayIds: readonly string[] },
): TemplateInstance {
  const parsed = PageDocSchema.safeParse(snapshot);
  if (!parsed.success) {
    return { ok: false, message: "This template's document cannot be read by this version of the app." };
  }
  let migrated: PageDoc;
  try {
    migrated = migratePageDoc(parsed.data);
  } catch (error) {
    return { ok: false, message: `This template cannot be used here: ${(error as Error).message}` };
  }
  const days = new Set(target.dayIds);
  return {
    ok: true,
    context: { tripId: target.tripId },
    content: { ...migrated, content: migrated.content.map((node) => rebindNode(node, days)) },
  };
}

function rebindAttrs(attrs: PageWidgetNode["attrs"], days: ReadonlySet<string>): PageWidgetNode["attrs"] {
  const day = attrs.params.day as { kind?: unknown; dayId?: unknown } | undefined;
  if (day?.kind !== "dayId" || (typeof day.dayId === "string" && days.has(day.dayId))) return attrs;
  return { ...attrs, params: { ...attrs.params, day: { kind: "dayId", dayId: UNRESOLVED_DAY_ID } } };
}

// Every depth, `migrateNodeWidgetNames`' walk. An `unknown` node is carried
// byte-identically (ADR-038 decision 3): rewriting inside a node this build
// admits it cannot read is editing it blind, and whatever it holds is not
// resolved by this build either.
function rebindNode(node: PageNode, days: ReadonlySet<string>): PageNode {
  switch (node.type) {
    case "macro":
      return { ...node, attrs: rebindAttrs(node.attrs, days) };
    case "repeat":
      return {
        ...node,
        attrs: rebindAttrs(node.attrs, days),
        content: node.content.map((child) => rebindInline(child, days)),
      };
    case "paragraph":
    case "heading":
      return { ...node, content: node.content.map((child) => rebindInline(child, days)) };
    case "blockquote":
      return { ...node, content: node.content.map((child) => rebindNode(child, days)) };
    case "bulletList":
    case "orderedList":
      return {
        ...node,
        content: node.content.map((item) =>
          item.type === "unknown" ? item : { ...item, content: item.content.map((child) => rebindNode(child, days)) },
        ),
      } as PageNode;
    case "codeBlock":
    case "horizontalRule":
    case "unknown":
      return node;
    default: {
      // KI-2026-09-05-h: a node type added without a case here would carry
      // another trip's day ids through untouched.
      const exhaustive: never = node;
      return exhaustive;
    }
  }
}

function rebindInline(node: PageInlineNode, days: ReadonlySet<string>): PageInlineNode {
  return node.type === "macro" ? { ...node, attrs: rebindAttrs(node.attrs, days) } : node;
}
