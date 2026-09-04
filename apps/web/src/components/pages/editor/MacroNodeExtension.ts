import { Node, mergeAttributes, ReactNodeViewRenderer } from "@tiptap/react";
import { getMacro } from "@tc/pages";
import { MacroNodeView } from "./MacroNodeView";

// The `macro` ProseMirror node. Its attrs shape mirrors `@tc/contracts`'
// MacroNode exactly (`{ name: string, params: Record<string, unknown> }`) so
// a page's saved `getJSON()` round-trips through the contract's schema
// validation without translation.
//
// One node type, not two: whether a given macro *presents* inline or as a
// block is a rendering decision (`getMacro(name).kind`), owned by MacroView
// (Task 4.2). The editor schema only needs one atom that can sit inside
// inline content (so `{{` autocomplete works anywhere text can go, including
// mid-paragraph for inline macros like `cost.trip`); block-kind macros still
// render full-width visually via their NodeView content — ProseMirror's
// schema doesn't need to know about that, only the DOM does.
export const MacroNodeExtension = Node.create({
  name: "macro",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      name: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-macro-name"),
        renderHTML: (attributes) => ({ "data-macro-name": attributes.name as string }),
      },
      params: {
        default: {},
        parseHTML: (element) => {
          const raw = element.getAttribute("data-macro-params");
          if (!raw) return {};
          try {
            return JSON.parse(raw) as Record<string, unknown>;
          } catch {
            return {};
          }
        },
        renderHTML: (attributes) => ({
          "data-macro-params": JSON.stringify(attributes.params ?? {}),
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-macro-name]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-macro": "" })];
  },

  // **The widget's SHAPE goes on the outer wrapper, because the caret depends
  // on it and only the outer wrapper is in the line box.**
  //
  // A macro node is an inline atom, so a block-shaped widget is a tall inline
  // box sitting on the text baseline: its bottom edge is the baseline, so it
  // grows the paragraph's line box UPWARD, and the browser draws the caret at
  // the line box's height. Mitchell, on the preview, twice: *"The cursor still
  // stretches past the sidebar up above the top of the previous widget."* The
  // caret was never misplaced — it was correctly filling a line a block widget
  // had made twenty times too tall.
  //
  // `globals.css` gives `[data-macro-shape="block"]` and `="repeat"`
  // `display: block`, which takes them out of that line box. `single` stays
  // inline: it IS a word in a sentence (SPEC §7) and its box is the size of one.
  //
  // It is set HERE and not inside `MacroNodeView` because `NodeViewWrapper`
  // renders INSIDE TipTap's own `.react-renderer` element, and that element is
  // the one ProseMirror puts in the text flow — `display: block` on a span
  // nested inside an inline span changes nothing about the line box. `attrs`
  // is TipTap's own hook for exactly this, and it re-runs on update, so a
  // rebind that changed a widget's shape would carry.
  addNodeView() {
    return ReactNodeViewRenderer(MacroNodeView, {
      attrs: ({ node }) => ({ "data-macro-shape": getMacro(node.attrs.name as string)?.shape ?? "single" }),
    });
  },
});
