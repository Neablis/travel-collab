import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/react";
import { EditorState } from "@tiptap/pm/state";
import { PAGE_EDITOR_EXTENSIONS } from "./extensions";
import { insertRepeatAt, repeatAt } from "./RepeatNodeExtension";

// `insertRepeatAt` is the placement rule the click, drop and slash inserts
// share (M14 PART 3 review, finding 2: a repeat inserted mid-sentence split
// the sentence in two). The drop is walked through `handleWidgetDrop` in
// `widgetDrop.test.ts`; these are the cases the other two origins add — a
// typed `/query` to remove, and the empty line an insert is usually made on.
const schema = getSchema(PAGE_EDITOR_EXTENSIONS);
const text = (t: string) => [{ type: "text", text: t }];
const repeatOf = (name: string, template?: string) => ({
  type: "repeat",
  attrs: { name, params: template === undefined ? {} : { template } },
});

function insert(content: unknown[], from: number, to = from) {
  const state = EditorState.create({ schema, doc: schema.nodeFromJSON({ type: "doc", content }) });
  const tr = state.tr;
  const at = insertRepeatAt(tr, schema.nodeFromJSON(repeatOf("stop.rows")), from, to);
  return { doc: (tr.doc.toJSON() as { content: unknown[] }).content, landed: repeatAt(tr.doc, at, at + 1) };
}

describe("insertRepeatAt — where a repeat lands", () => {
  it("removes a typed /query and lands after its sentence, where it can be selected", () => {
    // "Go /sent": the query is positions 4–9 inside the paragraph.
    const { doc, landed } = insert([{ type: "paragraph", content: text("Go /sent") }], 4, 9);
    expect(doc).toEqual([{ type: "paragraph", content: text("Go ") }, repeatOf("stop.rows")]);
    // paragraph(0) "Go "(1–4) close(4) → the repeat is the node at 5.
    expect(landed).toBe(5);
  });

  it("replaces the empty line it was made on, as a block insert always has", () => {
    const { doc, landed } = insert([{ type: "paragraph", content: text("Intro") }, { type: "paragraph" }], 8);
    expect(doc).toEqual([{ type: "paragraph", content: text("Intro") }, repeatOf("stop.rows")]);
    expect(landed).toBe(7);
  });

  it("goes beside a repeat already there, never replacing it — even one with no sentence yet", () => {
    const { doc } = insert([repeatOf("day.rows"), repeatOf("city.rows", "Hi {name}")], 1);
    expect(doc).toEqual([repeatOf("day.rows"), repeatOf("stop.rows"), repeatOf("city.rows", "Hi {name}")]);
  });
});
