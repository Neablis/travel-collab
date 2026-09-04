import type { EditorView } from "@tiptap/pm/view";
import { insertWidget } from "@tc/pages";
import { WIDGET_DRAG_TYPE } from "@/components/pages/WidgetPicker";

/**
 * Drop a widget onto the page — Mitchell, on the preview: *"I cant drag and drop
 * a widget onto page"*.
 *
 * It is the SAME insert as a click, at a position the pointer chose rather than
 * one the caret chose: `insertWidget` still builds and validates the node, so
 * ADR-037 decision 4 ("there is no way to put a widget into a document that
 * skips validation") holds for this origin too. The dragged payload carries a
 * NAME and nothing else, which is what keeps that true — dragging a built node
 * would be a second construction path, and the one thing decision 4 forbids.
 *
 * A function rather than an inline `editorProps.handleDrop` closure so it can be
 * tested. jsdom has no layout, so `posAtCoords` there answers `null` for every
 * real drop; the interesting behaviour — the MIME gate, the refusal of an
 * unknown widget, the position the node lands at — is all reachable with a stub
 * view and unreachable through a rendered editor.
 *
 * Returns `true` when it handled the drop, which is ProseMirror's contract for
 * "stop here".
 */
export function handleWidgetDrop(view: EditorView, event: DragEvent): boolean {
  // The custom MIME type is load-bearing. With `text/plain`, any dragged text —
  // a word from another paragraph, a URL from the address bar — would arrive
  // here looking like a widget name.
  const name = event.dataTransfer?.getData(WIDGET_DRAG_TYPE);
  if (!name) return false;

  const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
  if (at === null || at === undefined) return false;

  const built = insertWidget(name);
  if (!built.ok) return false;

  const macro = view.state.schema.nodes.macro;
  if (macro === undefined) return false;

  // Prevented only once we are certain we are handling it, so a drag this
  // editor does not understand still falls through to ProseMirror's own drop
  // handling (moving a selection, dropping text from elsewhere).
  event.preventDefault();
  view.dispatch(view.state.tr.insert(at.pos, macro.create(built.node.attrs)));
  return true;
}

/**
 * A drop event never fires unless `dragover` was prevented. ProseMirror
 * prevents it for drags it recognises; ours it does not, so without this the
 * row is draggable, the cursor says "copy", and the drop is silently discarded.
 *
 * Always returns `false` so ProseMirror still draws its drop cursor — this adds
 * permission, it does not take over the event.
 */
export function allowWidgetDragOver(event: DragEvent): boolean {
  if (event.dataTransfer?.types.includes(WIDGET_DRAG_TYPE)) {
    event.preventDefault();
  }
  return false;
}
