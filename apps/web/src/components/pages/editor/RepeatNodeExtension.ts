import { Node, mergeAttributes, ReactNodeViewRenderer } from "@tiptap/react";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { RepeatNodeView } from "./RepeatNodeView";

// The `repeat` ProseMirror node: an authored sentence repeated once per day,
// stop or city (ADR-035 decision 4, `@tc/pages`' `repeat.ts`).
//
// **A second node type, not a mode of `macro`**, as the ADR says: `macro` is an
// atom, and an atom cannot hold content an author edits. This one's content IS
// the row template — text and widget nodes, `inline*` — so the template is
// edited where it sits, with the same caret, typing and widget insert as any
// other sentence. That is what "Edit the wording" is (catalogue row 12): there
// is no wording dialog, because the wording is already on the page.
//
// Its attrs mirror `PageRepeatNode` exactly (`{ name, params }`), so `getJSON()`
// round-trips through the contract without translation — the same promise
// `MacroNodeExtension` makes for `macro`.
//
// `isolating`, so Backspace at the start of the template does not merge the
// sentence into the paragraph above (and so stop being a repeat), and a paste
// cannot split one repeat into two.
/**
 * Where the caret goes after a repeat is inserted: at the end of the first
 * repeat's template between `from` and `to`, so the author's next keystroke
 * writes the sentence rather than landing in the paragraph after it. `null`
 * when the range holds no repeat.
 */
export function repeatCaretIn(doc: ProseMirrorNode, from: number, to: number): number | null {
  let caret: number | null = null;
  doc.nodesBetween(from, Math.max(from, to), (child, pos) => {
    if (caret !== null) return false;
    if (child.type.name === "repeat") caret = pos + 1 + child.content.size;
    return caret === null;
  });
  return caret;
}

export const RepeatNodeExtension = Node.create({
  name: "repeat",
  group: "block",
  content: "inline*",
  isolating: true,
  defining: true,
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
    return ["div", mergeAttributes(HTMLAttributes, { "data-repeat": "" }), 0];
  },

  addKeyboardShortcuts() {
    return {
      // Enter ends the sentence rather than splitting it: a repeat holds ONE
      // line (it is the row template), and splitting would make two repeats
      // over the same collection. So Enter leaves it for a new paragraph.
      Enter: ({ editor }) => {
        const { $from, empty } = editor.state.selection;
        if (!empty || $from.parent.type.name !== this.name) return false;
        const after = $from.after();
        return editor.chain().insertContentAt(after, { type: "paragraph" }).setTextSelection(after + 1).run();
      },
      // An emptied sentence goes with one more Backspace, as an empty
      // paragraph would; `isolating` otherwise leaves no way out by keyboard.
      Backspace: ({ editor }) => {
        const { $from, empty } = editor.state.selection;
        if (!empty || $from.parent.type.name !== this.name || $from.parent.content.size !== 0) return false;
        return editor.commands.deleteNode(this.name);
      },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(RepeatNodeView);
  },
});
