import { describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/react";
import { winningReport, type SelectedWidget } from "./MacroEditorContext";

const widget = (key: string, name: string): SelectedWidget => ({
  key,
  name,
  params: {},
  // `winningReport` never touches the editor; it picks between reports.
  editor: {} as Editor,
});

// **The rule that decides which widget's settings are on screen**, and the one
// Mitchell reported as *"opening edit ui is inconsistent, not sure why it
// sometimes works and sometimes doesnt"*.
//
// It is tested here rather than through `PageScreen` because the thing that
// varies is an ORDER: two node views report in one commit, and React runs their
// effects in document order. jsdom can reproduce neither a ProseMirror click
// nor the document position that decides the order, so a screen test would fix
// one order and never see the other — which is exactly how this shipped.
describe("winningReport", () => {
  const a = widget("a", "cost");
  const b = widget("b", "dates");

  it("takes the claim when a release arrives first", () => {
    // A is open, B is clicked, and A happens to sit LOWER in the document — so
    // B's claim is reported before A's release. This is the order that was
    // broken: last-writer-wins read the release and closed the panel.
    expect(winningReport([b, null])).toBe(b);
  });

  it("takes the claim when the release arrives second, too", () => {
    // The other document order, which always worked. Both are asserted because
    // the whole defect was that only one of them did.
    expect(winningReport([null, b])).toBe(b);
  });

  it("clears only when nothing claimed the selection", () => {
    // A click into the prose: the one widget that had it says so, and no other
    // widget says anything.
    expect(winningReport([null])).toBeNull();
    // And the delete case, which is why `MacroNodeView` reports on unmount at
    // all: the selected widget is gone, nothing claims it, the panel closes
    // rather than editing a node that is no longer in the document.
    expect(winningReport([null, null])).toBeNull();
  });

  it("takes the LAST claim when two widgets both claim it", () => {
    // Not a state the editor can reach today — ProseMirror has one selection —
    // but the reduce has to answer it, and "the later one" is the only answer
    // that is not arbitrary.
    expect(winningReport([a, b])).toBe(b);
  });

  it("is null on an empty flush", () => {
    expect(winningReport([])).toBeNull();
  });
});
