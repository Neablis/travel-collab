import { Node, mergeAttributes, ReactNodeViewRenderer } from "@tiptap/react";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import { RepeatNodeView } from "./RepeatNodeView";

// The `repeat` ProseMirror node: an authored sentence printed once per day,
// stop or city (ADR-035 decision 4, `@tc/pages`' `repeat.ts`).
//
// **A leaf atom, like a widget**, since Mitchell's preview comment on PR #221
// (2026-09-24). Its sentence used to be the node's inline content, typed on the
// page with widgets in it; it is now one `template` string in `params`, written
// in the settings panel. Mitchell's rule is that Editing shows every widget as
// it reads, so the page shows the resolved lines in both modes, and the raw
// sentence appears only in the panel's text field.
//
// Its attrs mirror `PageRepeatNode` exactly (`{ name, params }`), so `getJSON()`
// round-trips through the contract without translation — the same promise
// `MacroNodeExtension` makes for `macro`. A stored repeat still holding content
// is a v2 document, and `migratePageDoc` empties it before the editor sees it.

/**
 * Where a repeat went after `insertRepeatAt`: the first repeat between `from`
 * and `to`, as a position a `NodeSelection` can take, or `null` when the range
 * holds none. Selecting it is what opens its settings, which is where its
 * sentence is written.
 */
export function repeatAt(doc: ProseMirrorNode, from: number, to: number): number | null {
  let found: number | null = null;
  doc.nodesBetween(from, Math.max(from + 1, to), (child, pos) => {
    if (found !== null) return false;
    if (child.type.name === "repeat") found = pos;
    return found === null;
  });
  return found;
}

/**
 * Put a repeat into the document at `from` (replacing `from`–`to` first), and
 * return where it landed. **The one placement rule for all three insert paths**
 * — click, drop and slash — so none of them can grow its own.
 *
 * A repeat is a block, and ProseMirror fits a block into a sentence by
 * SPLITTING the sentence (M14 PART 3 review, finding 2). So inside a textblock
 * it goes after the host block instead — never nested, never splitting. An
 * empty paragraph is replaced rather than left above it, which is what
 * TipTap's `insertContent` did for a block on an empty line and what the e2e
 * walk's "Enter, then insert" relies on.
 */
export function insertRepeatAt(tr: Transaction, repeat: ProseMirrorNode, from: number, to = from): number {
  if (to > from) tr.delete(from, to);
  const $pos = tr.doc.resolve(from);
  if ($pos.depth === 0 || !$pos.parent.isTextblock) {
    tr.insert(from, repeat);
    return from;
  }
  const [before, after] = [$pos.before(), $pos.after()];
  if ($pos.parent.content.size === 0) {
    tr.replaceWith(before, after, repeat);
    return before;
  }
  tr.insert(after, repeat);
  return after;
}

export const RepeatNodeExtension = Node.create({
  name: "repeat",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      name: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-repeat-name"),
        renderHTML: (attributes) => ({ "data-repeat-name": attributes.name as string }),
      },
      params: {
        default: {},
        parseHTML: (element) => {
          const raw = element.getAttribute("data-repeat-params");
          if (!raw) return {};
          try {
            return JSON.parse(raw) as Record<string, unknown>;
          } catch {
            return {};
          }
        },
        renderHTML: (attributes) => ({ "data-repeat-params": JSON.stringify(attributes.params ?? {}) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-repeat-name]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-repeat": "" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(RepeatNodeView);
  },
});
