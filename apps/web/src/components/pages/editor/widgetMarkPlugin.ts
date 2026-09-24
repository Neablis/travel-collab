import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { widgetMarks } from "./blockWidgets";

/** What a widget's node view finds on its decoration: its number in its block. */
export interface WidgetMarkSpec {
  widgetMark: number;
}

function marksFor(doc: PMNode): DecorationSet {
  return DecorationSet.create(
    doc,
    widgetMarks(doc).map(({ pos, mark }) =>
      Decoration.node(pos, pos + 1, {}, { widgetMark: mark } satisfies WidgetMarkSpec),
    ),
  );
}

/**
 * Hands every widget in a multi-widget block its number (SPEC §26), as a node
 * decoration.
 *
 * A decoration because it is the one channel ProseMirror re-renders a node view
 * through when something OTHER than that node changed: inserting a widget at
 * the start of a sentence renumbers the ones after it, and none of those nodes
 * changed. Recomputed only when the document did.
 */
export const widgetMarkPlugin = new Plugin<DecorationSet>({
  key: new PluginKey("widgetMarks"),
  state: {
    init: (_, state) => marksFor(state.doc),
    apply: (tr, previous) => (tr.docChanged ? marksFor(tr.doc) : previous),
  },
  props: {
    decorations(state) {
      return this.getState(state);
    },
  },
});
