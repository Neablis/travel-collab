import { Extension, type Editor, type Range } from "@tiptap/react";
import Suggestion, { type SuggestionOptions } from "@tiptap/suggestion";
import { macroCatalog } from "@tc/pages";

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
