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

  // An instance hidden from the public reader (M58) is that flag on the node;
  // an editor that does not declare the attribute drops it on the next autosave.
  it("keeps hideWhenPublic through getJSON(), and writes none when it is off", () => {
    const editor = new Editor({
      extensions: [StarterKit, MacroNodeExtension],
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "macro", attrs: { name: "cost.trip", params: {}, hideWhenPublic: true } },
              { type: "macro", attrs: { name: "cost.trip", params: {} } },
            ],
          },
        ],
      },
    });

    const [hidden, shown] = editor.getJSON().content?.[0]?.content ?? [];
    expect(hidden?.attrs).toEqual({ name: "cost.trip", params: {}, hideWhenPublic: true });
    // Saved as JSON, an unset flag is no key at all.
    expect(JSON.stringify(shown?.attrs)).not.toContain("hideWhenPublic");

    editor.destroy();
  });
});
