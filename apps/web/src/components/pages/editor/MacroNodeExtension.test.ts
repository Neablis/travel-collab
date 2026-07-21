import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { MacroNodeExtension } from "./MacroNodeExtension";

// Headless (no DOM render of the NodeView) round-trip test: a `macro` node's
// JSON survives set/get through the editor's schema unchanged. This is the
// primary persistence path (`@tc/contracts`' MacroNode shape via getJSON()),
// so this test guards the schema, not the React rendering.
describe("MacroNodeExtension", () => {
  it("round-trips a macro node's name and params through getJSON()", () => {
    const editor = new Editor({
      extensions: [StarterKit, MacroNodeExtension],
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "macro", attrs: { name: "cost.trip", params: {} } }],
          },
        ],
      },
    });

    const json = editor.getJSON();
    const macroNode = json.content?.[0]?.content?.[0];

    expect(macroNode).toEqual({
      type: "macro",
      attrs: { name: "cost.trip", params: {} },
    });

    editor.destroy();
  });

  it("round-trips non-empty params", () => {
    const editor = new Editor({
      extensions: [StarterKit, MacroNodeExtension],
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "macro", attrs: { name: "itinerary.day", params: { dayRef: { kind: "index", index: 2 } } } },
            ],
          },
        ],
      },
    });

    const json = editor.getJSON();
    const macroNode = json.content?.[0]?.content?.[0];

    expect(macroNode).toEqual({
      type: "macro",
      attrs: { name: "itinerary.day", params: { dayRef: { kind: "index", index: 2 } } },
    });

    editor.destroy();
  });
});
