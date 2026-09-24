import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/react";
import { EditorState, NodeSelection, TextSelection } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import { PAGE_EDITOR_EXTENSIONS } from "./extensions";
import { removeWidget, selectedBlock, widgetMarks, widgetsInBlockAt } from "./blockWidgets";

const schema = getSchema(PAGE_EDITOR_EXTENSIONS);

const macro = (name: string, params: Record<string, unknown> = {}) => ({ type: "macro", attrs: { name, params } });
const text = (t: string) => ({ type: "text", text: t });

// The gate sentence (M14, "two widgets in the SAME BLOCK read two different
// days"), then a paragraph with one widget of its own — which is the one that
// must never appear in the first sentence's settings, and must not be numbered.
function gateDoc(): PMNode {
  return schema.nodeFromJSON({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          text("We land on Day 1 in "),
          macro("city", { dates: { from: "2027-06-01", through: "2027-06-01" } }),
          text(" and by Day 9 we are in "),
          macro("city", { dates: { from: "2027-06-09", through: "2027-06-09" } }),
          text("."),
        ],
      },
      { type: "paragraph", content: [text("Total: "), macro("cost")] },
    ],
  });
}

// Positions of every macro atom, in document order — read off the document
// rather than hand-counted, so the assertions below do not depend on how long
// the prose around them is.
function macroPositions(doc: PMNode): number[] {
  const out: number[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "macro") out.push(pos);
  });
  return out;
}

describe("widgetsInBlockAt", () => {
  it("lists every widget in the selected widget's own block, numbered in document order", () => {
    const doc = gateDoc();
    const [first, second] = macroPositions(doc);

    // From EITHER widget in the sentence, the answer is the same two entries —
    // the panel is about the block, and which of its widgets you clicked only
    // decides which one is highlighted.
    for (const from of [first!, second!]) {
      const entries = widgetsInBlockAt(doc, from);
      expect(entries.map((e) => [e.mark, e.pos, e.params])).toEqual([
        [1, first, { dates: { from: "2027-06-01", through: "2027-06-01" } }],
        [2, second, { dates: { from: "2027-06-09", through: "2027-06-09" } }],
      ]);
    }
  });

  it("does not reach into another block", () => {
    const doc = gateDoc();
    const third = macroPositions(doc)[2]!;
    expect(widgetsInBlockAt(doc, third).map((e) => [e.mark, e.name])).toEqual([[1, "cost"]]);
  });

  it("answers nothing for a position that is not a widget", () => {
    expect(widgetsInBlockAt(gateDoc(), 1)).toEqual([]);
  });
});

describe("widgetMarks", () => {
  // The in-text number is a cross-reference to the panel. A block with one
  // widget has nothing to tell apart, so it carries no number (dc.html's
  // `multi: rows.length > 1`).
  it("numbers the widgets of a block holding two or more, and only those", () => {
    const doc = gateDoc();
    const [first, second] = macroPositions(doc);
    expect(widgetMarks(doc)).toEqual([
      { pos: first, mark: 1 },
      { pos: second, mark: 2 },
    ]);
  });
});

describe("selectedBlock", () => {
  it("reads the block from the editor's own node selection", () => {
    const doc = gateDoc();
    const [, second] = macroPositions(doc);
    const state = EditorState.create({ doc, selection: NodeSelection.create(doc, second!) });
    const block = selectedBlock(state);
    expect(block?.selectedPos).toBe(second);
    expect(block?.entries.map((e) => e.mark)).toEqual([1, 2]);
  });

  it("is null when the selection is a caret in the prose", () => {
    const doc = gateDoc();
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, 3) });
    expect(selectedBlock(state)).toBeNull();
  });
});

describe("removeWidget", () => {
  it("removes exactly the widget it is given and keeps the other one in the sentence", () => {
    const doc = gateDoc();
    const [first, second] = macroPositions(doc);
    const state = EditorState.create({ doc, selection: NodeSelection.create(doc, second!) });

    const next = state.apply(removeWidget(state, first!));
    const left = macroPositions(next.doc).map((pos) => next.doc.nodeAt(pos)!.attrs.params as unknown);
    expect(left).toEqual([{ dates: { from: "2027-06-09", through: "2027-06-09" } }, {}]);
    // The prose around it is untouched — Remove takes a widget, not a sentence.
    expect(next.doc.firstChild!.textContent).toBe("We land on Day 1 in  and by Day 9 we are in .");
  });

  // Removing the SELECTED widget would otherwise leave nothing selected, and the
  // panel would close under the person still working through the sentence.
  it("moves the selection to a remaining widget of the block when the selected one goes", () => {
    const doc = gateDoc();
    const [first, second] = macroPositions(doc);
    const state = EditorState.create({ doc, selection: NodeSelection.create(doc, first!) });

    const next = state.apply(removeWidget(state, first!));
    expect(next.selection).toBeInstanceOf(NodeSelection);
    const selected = (next.selection as NodeSelection).node;
    expect(selected.attrs.params).toEqual({ dates: { from: "2027-06-09", through: "2027-06-09" } });
    // It really did move: this widget sat at `second` before the delete.
    expect(next.selection.from).toBe(second! - 1);
  });
});
