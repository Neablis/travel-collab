import { describe, expect, it } from "vitest";
import { markdownToPageNodes } from "./markdownToPageNodes";

const text = (t: string) => ({ type: "text", text: t });
const para = (t: string) => ({ type: "paragraph", content: [text(t)] });
const item = (t: string) => ({ type: "listItem", content: [para(t)] });

describe("markdownToPageNodes", () => {
  it("reads headings at every level the AST allows", () => {
    expect(markdownToPageNodes("# One\n\n###### Six")).toEqual([
      { type: "heading", attrs: { level: 1 }, content: [text("One")] },
      { type: "heading", attrs: { level: 6 }, content: [text("Six")] },
    ]);
  });

  // A single newline is a soft wrap in markdown. Breaking every wrapped line
  // into its own paragraph would reflow someone's prose into confetti.
  it("joins soft-wrapped lines into one paragraph, and splits on a blank line", () => {
    expect(markdownToPageNodes("one\ntwo\n\nthree")).toEqual([para("one two"), para("three")]);
  });

  // One list, not N single-item lists — which is what a per-line emit produces,
  // and it renders as something that looks like a bug because it is one.
  it("joins consecutive bullets into a single list", () => {
    expect(markdownToPageNodes("- a\n- b")).toEqual([
      { type: "bulletList", content: [item("a"), item("b")] },
    ]);
  });

  it("honours the first number of an ordered list, so '3.' starts at three", () => {
    expect(markdownToPageNodes("3. c\n4. d")).toEqual([
      { type: "orderedList", attrs: { start: 3, type: null }, content: [item("c"), item("d")] },
    ]);
  });

  it("keeps the two list kinds apart rather than merging them", () => {
    const nodes = markdownToPageNodes("- a\n1. b");
    expect(nodes.map((n) => n.type)).toEqual(["bulletList", "orderedList"]);
  });

  // Documented, not accidental. Half-parsing marks is how a page ends up with a
  // literal `**` in one place and bold in another; the AST refuses to carry a
  // mark the editor cannot produce, so the honest answer is plain text.
  it("does not interpret inline marks — asterisks arrive as text", () => {
    expect(markdownToPageNodes("**bold**")).toEqual([para("**bold**")]);
  });

  it("is empty for empty or whitespace-only input", () => {
    expect(markdownToPageNodes("")).toEqual([]);
    expect(markdownToPageNodes("\n\n  \n")).toEqual([]);
  });

  it("closes an open list or paragraph at the end of the input", () => {
    expect(markdownToPageNodes("- only")).toEqual([{ type: "bulletList", content: [item("only")] }]);
    expect(markdownToPageNodes("trailing")).toEqual([para("trailing")]);
  });
});
