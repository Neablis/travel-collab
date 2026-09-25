import { NodeSelection, type EditorState, type Transaction } from "@tiptap/pm/state";

// The settings panel is about ONE widget: the one the editor's selection is on
// (KI-2026-09-24-x; Mitchell on PR #221: *"Just have 1 selected at a time."*).
// It used to be about the whole block the selected widget sat in, one numbered
// entry per widget, with the same numbers on the handles in the text — so
// changing the widget you had clicked meant matching its number to an entry.
//
// Each widget in a sentence is still bound on its own (ADR-037 open question 1,
// as Mitchell settled it: *"i should be able to have a notebook that shows day
// 1, day 3 and day 9, if we lock all widgets to one selection, its not
// possible"*). Every write below addresses one position, and reaching the
// sentence's other widget is a click on it.
//
// Everything here is a pure read of a state or a transaction built from one.

/** The inline widget the editor's selection is on: where it sits, what it reads, and its params. */
export interface SelectedInline {
  /** Document position of the widget's atom — what a write addresses. */
  pos: number;
  name: string;
  params: Record<string, unknown>;
}

/**
 * The widget the panel is about, read from the EDITOR'S OWN selection — a
 * ProseMirror node selection on a `macro` atom, which is what clicking a widget,
 * inserting one, or `MacroNodeView`'s re-select all produce.
 *
 * Not from the `SelectedWidget` the screen holds: that is a report, deduplicated
 * by value (`PageScreen`), so two identical unbound widgets are one report to
 * it. The editor's selection is the fact the report is about.
 */
export function selectedWidget(state: EditorState): SelectedInline | null {
  const { selection } = state;
  if (!(selection instanceof NodeSelection) || selection.node.type.name !== "macro") return null;
  return {
    pos: selection.from,
    name: selection.node.attrs.name as string,
    params: (selection.node.attrs.params ?? {}) as Record<string, unknown>,
  };
}

/**
 * Rebinds ONE widget, and it is the only writer the panel has.
 *
 * `setNodeAttribute` (an `AttrStep`), not TipTap's `updateAttributes`: that one
 * is `setNodeMarkup`, which REPLACES a leaf node — so the node selection did not
 * survive a rebind, and `MacroNodeView` had to re-select in a microtask or the
 * panel closed on the first thing you did in it. An attribute step changes no
 * positions, so the selection maps onto the same widget and its panel stays up.
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
 * its own, so its panel is always one entry, as an inline widget's is.
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
 * Points a repeat or a rows table at another collection: its `name` and its
 * params in one transaction — so one undo step, and no state in which the node
 * names one collection with the other's filters. It is `rebindWidget` plus the
 * name: attribute steps, so the node stays selected and its panel stays up.
 */
export function rescopeWidgetAt(state: EditorState, pos: number, name: string, params: Record<string, unknown>): Transaction {
  return rebindWidget(state, pos, params).setNodeAttribute(pos, "name", name);
}

/**
 * Removes ONE widget, never the prose around it.
 *
 * The selection falls into the text and the panel closes, even when the
 * sentence holds other widgets. The panel shows one widget at a time, so moving
 * the selection to a sibling would put a panel straight back up, often under
 * the same title ("The cities" twice in one sentence), and read as if Remove had
 * not worked (KI-2026-09-24-x).
 */
export function removeWidget(state: EditorState, pos: number): Transaction {
  return state.tr.delete(pos, pos + 1);
}
