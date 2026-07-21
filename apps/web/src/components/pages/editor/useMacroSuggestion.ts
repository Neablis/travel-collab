import { Extension, ReactRenderer, type Editor, type Range } from "@tiptap/react";
import Suggestion, {
  type SuggestionKeyDownProps,
  type SuggestionOptions,
  type SuggestionProps,
} from "@tiptap/suggestion";
import tippy, { type Instance as TippyInstance } from "tippy.js";
import "tippy.js/dist/tippy.css";
import { macroCatalog } from "@tc/pages";
import {
  MacroSuggestionList,
  type MacroSuggestionListProps,
  type MacroSuggestionListRef,
} from "./MacroSuggestionList";

export interface MacroCatalogItem {
  name: string;
  kind: string;
  description: string;
  emptyText: string;
}

// Builds the `@tiptap/suggestion` options: triggered by `{{`, lists
// `@tc/pages`' macro catalog filtered by the typed query against
// `name`/`description`, and inserts a `macro` node with empty params on
// select (the immediate next keystroke can then fill params via the node's
// own affordances — param editing UI is a later task).
//
// This returns *options*, not a plugin, so it stays unit-testable without a
// live editor: `items({ query })` can be exercised directly. The plugin
// itself needs a live `Editor` instance (Suggestion's `editor` option), so
// that wiring lives in `MacroSuggestionExtension` below.
export function macroSuggestionOptions(): Omit<SuggestionOptions<MacroCatalogItem>, "editor"> {
  return {
    char: "{{",
    allowSpaces: false,
    items: ({ query }: { query: string }): MacroCatalogItem[] => {
      const q = query.trim().toLowerCase();
      const all = macroCatalog();
      if (!q) return all;
      return all.filter(
        (m) => m.name.toLowerCase().includes(q) || m.description.toLowerCase().includes(q),
      );
    },
    command: ({ editor, range, props }: { editor: Editor; range: Range; props: MacroCatalogItem }) => {
      editor
        .chain()
        .focus()
        .insertContentAt(range, [{ type: "macro", attrs: { name: props.name, params: {} } }])
        .run();
    },
    // The floating popup: a `MacroSuggestionList` rendered via `ReactRenderer`
    // (the standard TipTap pattern — the same one used by every published
    // `@tiptap/suggestion` mention example) and positioned by a `tippy`
    // instance anchored to the suggestion's `clientRect`. Both the renderer
    // and the tippy instance are created once in `onStart` and torn down in
    // `onExit`; `onUpdate` only patches props/position, and `onKeyDown`
    // forwards to the list's imperative handle so Arrow/Enter/Escape work
    // without the list needing DOM focus (the editor keeps it).
    render: () => {
      let component: ReactRenderer<MacroSuggestionListRef, MacroSuggestionListProps>;
      let popup: TippyInstance[];

      return {
        onStart: (props: SuggestionProps<MacroCatalogItem>) => {
          component = new ReactRenderer(MacroSuggestionList, {
            props: { items: props.items, command: props.command },
            editor: props.editor,
          });
          if (!props.clientRect) return;
          popup = tippy("body", {
            getReferenceClientRect: () => props.clientRect!() ?? new DOMRect(),
            appendTo: () => document.body,
            content: component.element,
            showOnCreate: true,
            interactive: true,
            trigger: "manual",
            placement: "bottom-start",
          });
        },
        onUpdate: (props: SuggestionProps<MacroCatalogItem>) => {
          component.updateProps({ items: props.items, command: props.command });
          if (!props.clientRect) return;
          popup?.[0]?.setProps({ getReferenceClientRect: () => props.clientRect!() ?? new DOMRect() });
        },
        onKeyDown: (props: SuggestionKeyDownProps): boolean => {
          if (props.event.key === "Escape") {
            popup?.[0]?.hide();
            return true;
          }
          return component.ref?.onKeyDown(props) ?? false;
        },
        onExit: () => {
          popup?.[0]?.destroy();
          component?.destroy();
        },
      };
    },
  };
}

// The registerable TipTap extension: wraps `macroSuggestionOptions()` into a
// ProseMirror plugin bound to the live editor. Include this alongside
// `MacroNodeExtension` in `PageEditor`'s extension list.
export const MacroSuggestionExtension = Extension.create({
  name: "macroSuggestion",

  addOptions() {
    return {
      suggestion: macroSuggestionOptions(),
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ];
  },
});
