import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/react";
import { EditorState } from "@tiptap/pm/state";
import { PAGE_EDITOR_EXTENSIONS } from "./extensions";
import { insertRepeatAt, repeatCaretIn } from "./RepeatNodeExtension";

// `insertRepeatAt` is the placement rule the click, drop and slash inserts
// share (M14 PART 3 review, finding 2: a repeat inserted mid-sentence split
// the sentence in two). The drop is walked through `handleWidgetDrop` in
// `widgetDrop.test.ts`; these are the cases the other two origins add — a
// typed `/query` to remove, and the empty line an insert is usually made on.
const schema = getSchema(PAGE_EDITOR_EXTENSIONS);
const text = (t: string) => [{ type: "text", text: t }];
const repeatOf = (name: string, content?: unknown[]) => ({
  type: "repeat",
  attrs: { name, params: {} },
  ...(content ? { content } : {}),
});

function insert(content: unknown[], from: number, to = from) {
  const state = EditorState.create({ schema, doc: schema.nodeFromJSON({ type: "doc", content }) });
  const tr = state.tr;
  const at = insertRepeatAt(tr, schema.nodeFromJSON(repeatOf("stop.rows")), from, to);
  return { doc: (tr.doc.toJSON() as { content: unknown[] }).content, caret: repeatCaretIn(tr.doc, at, at + 1) };
}

describe("insertRepeatAt — where a repeat lands", () => {
  it("removes a typed /query and lands after its sentence, caret in the new template", () => {
    // "Go /sent": the query is positions 4–9 inside the paragraph.
    const { doc, caret } = insert([{ type: "paragraph", content: text("Go /sent") }], 4, 9);
    expect(doc).toEqual([{ type: "paragraph", content: text("Go ") }, repeatOf("stop.rows")]);
    // paragraph(0) "Go "(1–4) close(4) → the repeat opens at 5, template at 6.
    expect(caret).toBe(6);
  });

  it("a /query typed inside a repeat's template leaves that repeat whole and lands after it", () => {
    // Typed mid-sentence: "On /sday", the query at 4–6.
    const { doc } = insert([repeatOf("day.rows", text("On /sday"))], 4, 6);
    expect(doc).toEqual([repeatOf("day.rows", text("On day")), repeatOf("stop.rows")]);
  });

  it("replaces the empty line it was made on, as a block insert always has", () => {
    const { doc, caret } = insert([{ type: "paragraph", content: text("Intro") }, { type: "paragraph" }], 8);
    expect(doc).toEqual([{ type: "paragraph", content: text("Intro") }, repeatOf("stop.rows")]);
    expect(caret).toBe(8);
  });

  it("does not replace an empty REPEAT — that is a sentence not yet written", () => {
    const { doc } = insert([repeatOf("day.rows")], 1);
    expect(doc).toEqual([repeatOf("day.rows"), repeatOf("stop.rows")]);
  });
});
