import type { Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection, type EditorState, type Transaction } from "@tiptap/pm/state";

// SPEC §26: *"one entry per bound widget (never aggregated — a sentence holding
// two day-bound widgets shows two, numbered to match the marks in the text)"*.
//
// The unit of the settings panel is therefore the BLOCK the selected widget
// sits in, not the widget: "We land on Day 1 in Tokyo and by Day 9 we are in
// Kyoto" is one paragraph with two widgets, and both have to be reachable from
// either. ADR-037 open question 1 is why each keeps its own entry — Mitchell:
// *"i should be able to have a notebook that shows day 1, day 3 and day 9, if
// we lock all widgets to one selection, its not possible"*.
//
// Everything here is a pure read of a document or a transaction built from a
// state, so the numbering the panel shows and the numbering the handles show
// come from one function and cannot disagree.

export interface BlockWidget {
  /** Document position of the widget's atom — what a write addresses. */
  pos: number;
  /** 1-based, in document order within its block: the number in the text. */
  mark: number;
  name: string;
  params: Record<string, unknown>;
}

function isWidget(node: PMNode | null | undefined): node is PMNode {
  return node?.type.name === "macro";
}

// A widget is an inline atom (`MacroNodeExtension`), so its parent is always
// the textblock it is written in — a paragraph, a heading, a list item's
// paragraph. That textblock is "the block".
function widgetsOf(block: PMNode, start: number): BlockWidget[] {
  const out: BlockWidget[] = [];
  block.forEach((child, offset) => {
    if (!isWidget(child)) return;
    out.push({
      pos: start + offset,
      mark: out.length + 1,
      name: child.attrs.name as string,
      params: (child.attrs.params ?? {}) as Record<string, unknown>,
    });
  });
  return out;
}

/** Every widget in the block holding the widget at `pos`; empty if `pos` holds none. */
export function widgetsInBlockAt(doc: PMNode, pos: number): BlockWidget[] {
  if (pos < 0 || pos >= doc.content.size || !isWidget(doc.nodeAt(pos))) return [];
  const $pos = doc.resolve(pos);
  return widgetsOf($pos.parent, $pos.start());
}

/**
 * The numbers the handles carry: one per widget, in blocks holding two or more.
 *
 * A block with a single widget gets none. The number is a cross-reference from
 * the text to the panel, and with one entry there is nothing to tell apart —
 * the design numbers rows only when `rows.length > 1`.
 */
export function widgetMarks(doc: PMNode): { pos: number; mark: number }[] {
  const out: { pos: number; mark: number }[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const entries = widgetsOf(node, pos + 1);
    if (entries.length > 1) out.push(...entries.map(({ pos: at, mark }) => ({ pos: at, mark })));
    // Widgets are inline, so nothing inside a textblock can hold another block.
    return false;
  });
  return out;
}

/**
 * The block the panel is about, read from the EDITOR'S OWN selection.
 *
 * Not from the `SelectedWidget` the screen holds: that is a report, deduplicated
 * by value (`PageScreen`), so two identical unbound widgets in different blocks
 * are one report to it. The editor's selection is the fact the report is about.
 */
export function selectedBlock(state: EditorState): { selectedPos: number; entries: BlockWidget[] } | null {
  const { selection } = state;
  if (!(selection instanceof NodeSelection) || !isWidget(selection.node)) return null;
  return { selectedPos: selection.from, entries: widgetsInBlockAt(state.doc, selection.from) };
}

/**
 * Rebinds ONE widget, and it is the only writer the panel has.
 *
 * `setNodeAttribute` (an `AttrStep`), not TipTap's `updateAttributes`: that one
 * is `setNodeMarkup`, which REPLACES a leaf node — so the node selection did not
 * survive a rebind, and `MacroNodeView` had to re-select in a microtask or the
 * panel closed on the first thing you did in it. An attribute step changes no
 * positions, so the selection maps onto the same widget, and rebinding entry 2
 * does not disturb the selection sitting on entry 1.
 */
export function rebindWidget(state: EditorState, pos: number, params: Record<string, unknown>): Transaction {
  return state.tr.setNodeAttribute(pos, "params", params);
}

/** The repeat the settings panel is about: where it sits, what it reads, and its params. */
export interface SelectedRepeat {
  pos: number;
  name: string;
  params: Record<string, unknown>;
}

/**
 * The repeat the editor's selection is on, or `null`. A repeat is a block of
 * its own, so its panel is always one entry: it has no sentence of sibling
 * widgets to number, as a widget does.
 */
export function selectedRepeat(state: EditorState): SelectedRepeat | null {
  const { selection } = state;
  if (!(selection instanceof NodeSelection) || selection.node.type.name !== "repeat") return null;
  return {
    pos: selection.from,
    name: selection.node.attrs.name as string,
    params: (selection.node.attrs.params ?? {}) as Record<string, unknown>,
  };
}

/**
 * Points a repeat at another collection: its `name` and its params in one
 * transaction, so no state exists in which the node names one collection with
 * the other's filters. Attribute steps, like `rebindWidget`, so it stays selected.
 */
export function rescopeRepeatAt(state: EditorState, pos: number, name: string, params: Record<string, unknown>): Transaction {
  return state.tr.setNodeAttribute(pos, "name", name).setNodeAttribute(pos, "params", params);
}

/**
 * Removes ONE widget, never the prose around it.
 *
 * If it was the selected widget and the block still holds others, the selection
 * moves to the first of them — otherwise nothing would be selected and the panel
 * would close under someone working through a sentence's widgets one by one.
 * When it was the last one, the selection falls into the text and the panel
 * closes, which is right: there is nothing left to configure.
 */
export function removeWidget(state: EditorState, pos: number): Transaction {
  const siblings = widgetsInBlockAt(state.doc, pos).filter((entry) => entry.pos !== pos);
  const wasSelected = state.selection instanceof NodeSelection && state.selection.from === pos;
  const tr = state.tr.delete(pos, pos + 1);
  const next = siblings[0];
  if (wasSelected && next !== undefined) {
    tr.setSelection(NodeSelection.create(tr.doc, tr.mapping.map(next.pos)));
  }
  return tr;
}
