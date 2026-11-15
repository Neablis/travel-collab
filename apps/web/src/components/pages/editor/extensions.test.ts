// @vitest-environment jsdom
// A real view, so a dispatched transaction runs the plugins; under the node
// project the editor has none, and trailingNode would never get its chance.
import { describe, expect, it } from "vitest";
import { Editor, getSchema } from "@tiptap/react";
import { CURRENT_PAGE_DOC_VERSION } from "@tc/contracts";
import { PAGE_EDITOR_EXTENSIONS } from "./extensions";
import { toStoredPageDoc } from "./storedPageDoc";

// TipTap 3's StarterKit brought four extensions 2.x did not have (link,
// underline, trailingNode, listKeymap), and `extensions.ts` turns them off so
// the upgrade (KI-2026-10-18-b) changes nothing a page stores. These tests are
// what notices when a later bump brings another one in by default.
describe("the editor's vocabulary after the TipTap 3 upgrade", () => {
  it("has exactly the marks it had on TipTap 2", () => {
    // A `link` mark would autolink a typed URL into a stored `href`; an
    // `underline` mark is a formatting no page was ever written with.
    expect(Object.keys(getSchema(PAGE_EDITOR_EXTENSIONS).marks).sort()).toEqual(["bold", "code", "italic", "strike"]);
  });

  it("stores the document it opened unchanged, through a transaction and the serialiser", () => {
    // Ends in a horizontal rule on purpose: trailingNode appends an empty
    // paragraph after any last node that is not one, on the first transaction,
    // so a page that was only opened would be saved changed.
    const stored = {
      v: CURRENT_PAGE_DOC_VERSION,
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Day one" }] },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "see " },
            { type: "text", text: "https://example.com", marks: [{ type: "bold" }] },
            { type: "macro", attrs: { name: "cost", params: {} } },
          ],
        },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }] }] },
        { type: "horizontalRule" },
      ],
    };
    const editor = new Editor({ extensions: PAGE_EDITOR_EXTENSIONS, content: stored as unknown as Record<string, unknown> });
    try {
      editor.view.dispatch(editor.state.tr.setMeta("probe", true));
      expect(JSON.stringify(toStoredPageDoc(editor.getJSON()))).toBe(JSON.stringify(stored));
    } finally {
      editor.destroy();
    }
  });
});
