import { describe, expect, it, vi } from "vitest";
import type { EditorView } from "@tiptap/pm/view";
import { getSchema } from "@tiptap/react";
import { PAGE_EDITOR_EXTENSIONS } from "./extensions";
import { allowWidgetDragOver, handleWidgetDrop } from "./widgetDrop";
import { WIDGET_DRAG_TYPE } from "@/components/pages/WidgetPicker";

// The REAL schema the editor runs, not a hand-built one: the point of these
// tests is that a dropped widget produces a node this document can hold, and a
// stub schema would assert that against a fiction.
const schema = getSchema(PAGE_EDITOR_EXTENSIONS);

function dragEvent({ type = WIDGET_DRAG_TYPE, data }: { type?: string; data: string }): DragEvent {
  return {
    clientX: 40,
    clientY: 80,
    preventDefault: vi.fn(),
    dataTransfer: {
      types: [type],
      getData: (asked: string) => (asked === type ? data : ""),
    },
  } as unknown as DragEvent;
}

// jsdom has no layout, so a rendered editor answers `null` to every
// `posAtCoords` — which is exactly the branch that makes a real drop a no-op.
// A stub view is what makes the other branches reachable at all.
function stubView({ pos = 3 }: { pos?: number | null } = {}) {
  const dispatch = vi.fn();
  const view = {
    state: { schema, tr: { insert: (at: number, node: unknown) => ({ at, node }) } },
    posAtCoords: () => (pos === null ? null : { pos, inside: pos }),
    dispatch,
  } as unknown as EditorView;
  return { view, dispatch };
}

describe("dropping a widget onto the page", () => {
  it("builds the dropped widget through insertWidget, at the position dropped on", () => {
    const { view, dispatch } = stubView({ pos: 7 });
    const event = dragEvent({ data: "cost.trip" });

    expect(handleWidgetDrop(view, event)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();

    const { at, node } = dispatch.mock.calls[0]![0] as { at: number; node: { type: { name: string }; attrs: Record<string, unknown> } };
    // The POSITION the pointer chose, not the caret's — that is the whole
    // difference between this origin and the popover's click.
    expect(at).toBe(7);
    expect(node.type.name).toBe("macro");
    expect(node.attrs.name).toBe("cost.trip");
  });

  // ADR-037 decision 4: "there is no way to put a widget into a document that
  // skips validation". The drag payload is a name, so this is the check that
  // stops a name nothing in the registry answers to from reaching the document.
  it("refuses a name the registry does not know, and leaves the document alone", () => {
    const { view, dispatch } = stubView();
    const event = dragEvent({ data: "not.a.widget" });

    expect(handleWidgetDrop(view, event)).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
    // Not prevented either: a drag this editor cannot use must still fall
    // through to ProseMirror's own handling rather than being swallowed.
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  // The custom MIME type is the gate. With `text/plain` any dragged word would
  // arrive here looking like a widget name.
  it("ignores a drag that is not carrying a widget", () => {
    const { view, dispatch } = stubView();
    const event = dragEvent({ type: "text/plain", data: "cost.trip" });

    expect(handleWidgetDrop(view, event)).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("does nothing when the drop point cannot be resolved", () => {
    const { view, dispatch } = stubView({ pos: null });
    expect(handleWidgetDrop(view, dragEvent({ data: "cost.trip" }))).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe("allowing the drag over the editor", () => {
  // Without this the row is draggable, the cursor says "copy", and the drop is
  // silently discarded — a browser fires no `drop` unless `dragover` was
  // prevented.
  it("permits a widget drag, and always lets ProseMirror keep handling it", () => {
    const event = dragEvent({ data: "cost.trip" });
    expect(allowWidgetDragOver(event)).toBe(false);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("leaves any other drag exactly as it was", () => {
    const event = dragEvent({ type: "text/plain", data: "hello" });
    expect(allowWidgetDragOver(event)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
