import { Node, mergeAttributes, ReactNodeViewRenderer } from "@tiptap/react";
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

  addNodeView() {
    return ReactNodeViewRenderer(MacroNodeView);
  },
});
