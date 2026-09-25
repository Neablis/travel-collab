import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/react";
import { EditorState, NodeSelection, TextSelection } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import { PAGE_EDITOR_EXTENSIONS } from "./extensions";
import { removeWidget, selectedWidget } from "./blockWidgets";

const schema = getSchema(PAGE_EDITOR_EXTENSIONS);

const macro = (name: string, params: Record<string, unknown> = {}) => ({ type: "macro", attrs: { name, params } });
const text = (t: string) => ({ type: "text", text: t });

// The gate sentence (M14, "two widgets in the SAME BLOCK read two different
// days"), then a paragraph with one widget of its own.
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

describe("selectedWidget", () => {
  // The panel is about ONE widget (KI-2026-09-24-x): the one the node selection
  // is on, even when its sentence holds another.
  it("reads the one widget the editor's node selection is on", () => {
    const doc = gateDoc();
    const [, second] = macroPositions(doc);
    const state = EditorState.create({ doc, selection: NodeSelection.create(doc, second!) });
    expect(selectedWidget(state)).toEqual({
      pos: second,
      name: "city",
      params: { dates: { from: "2027-06-09", through: "2027-06-09" } },
    });
  });

  it("is null when the selection is a caret in the prose", () => {
    const doc = gateDoc();
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, 3) });
    expect(selectedWidget(state)).toBeNull();
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

  // The panel shows one widget at a time, so a selection moved onto a sibling
  // would reopen it at once — often under the same title — and read as if
  // Remove had not worked.
  it("lets the selection fall into the text when the selected widget goes, even with a sibling left", () => {
    const doc = gateDoc();
    const [first] = macroPositions(doc);
    const state = EditorState.create({ doc, selection: NodeSelection.create(doc, first!) });

    const next = state.apply(removeWidget(state, first!));
    expect(macroPositions(next.doc)).toHaveLength(2);
    expect(selectedWidget(next)).toBeNull();
  });
});
