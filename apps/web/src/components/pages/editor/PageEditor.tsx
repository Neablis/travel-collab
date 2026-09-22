"use client";
import { useEditor, EditorContent, type Editor, type JSONContent } from "@tiptap/react";
import { useEffect, useRef } from "react";
import type { TripDetail, PageContext, PageDoc, TripGlobals, UserPreferences } from "@tc/contracts";
import { insertPreset } from "@tc/pages";
import { PAGE_EDITOR_EXTENSIONS } from "./extensions";
import { MacroEditorContext, type MacroEditorContextValue } from "./MacroEditorContext";
import { SlashMenu } from "./SlashMenu";
import { useSlashMenu } from "./useSlashMenu";
import { allowWidgetDragOver, handleWidgetDrop } from "./widgetDrop";

export interface PageEditorProps {
  detail: TripDetail;
  context: PageContext;
  user?: UserPreferences | null;
  globals?: TripGlobals | null;
  value: PageDoc;
  onChange: (content: unknown) => void;
  onBindDay?: () => void;
  // Hands the live editor up so a surface OUTSIDE it — the widget sidebar —
  // can insert at the cursor. The sidebar sits beside the editor rather than
  // inside it, and lifting `useEditor` into `PageScreen` would put TipTap in a
  // component with no business knowing about it.
  //
  // Called with `null` on unmount, so a caller holding the last editor cannot
  // dispatch into a destroyed view.
  onEditorReady?: (editor: Editor | null) => void;
  // Reading mode. ADR-037 decision 4 and §18: Reading is the traveller's view
  // and shows no insert affordance and no chrome.
  editable?: boolean;
  // SPEC §26: the surface's side channel subscribes here, so a widget's
  // settings can live outside the document. Omitted by surfaces that have no
  // side channel to put them in — the Overview tab (§25) mounts this read-only
  // and passes nothing.
  onWidgetSelected?: MacroEditorContextValue["onWidgetSelected"];
}

// The rich-text editor for a page: StarterKit's usual marks/blocks, plus the
// `macro` atom node. `detail`/`context` reach each macro's NodeView via
// `MacroEditorContext`, not extension `storage` — see that file for why
// (storage updates aren't reactive; a Provider re-render is).
//
// `value` is a PARSED `PageDoc`, not raw stored JSON, and that is the ADR-038
// decision 4 contract with this component: whoever mounts it has already run
// `inspectStoredPageDoc` and been told the document is mountable. Handing it
// arbitrary stored JSON is the bug — TipTap answers an unknown node type by
// discarding the entire document and letting the next keystroke autosave the
// empty one over it. This component cannot defend against that; only its caller
// can, by not mounting.
//
// `onChange` emits raw `getJSON()`, deliberately typed `unknown`: it is what the
// editor produced, not yet something we have agreed to store. `toStoredPageDoc`
// is the step in between.
/**
 * Structural equality for two documents, for the re-sync effect below.
 *
 * **Not `JSON.stringify`.** One side comes from the server's stored document
 * and the other from TipTap's own serializer, so key order is not guaranteed to
 * match even when the documents are identical — and a false "different" here
 * resets the editor on every poll. A ProseMirror document is plain JSON, so a
 * recursive walk is total.
 *
 * The domain has a twin of this (`pageState.ts`'s `docsEqual`) which cannot be
 * imported here: `@tc/domain` is walled off from UI code, and widening that
 * wall to share nine lines would be the wrong trade.
 */
function sameDocument(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => sameDocument(item, b[i]));
  }
  const ax = a as Record<string, unknown>;
  const bx = b as Record<string, unknown>;
  const keys = Object.keys(ax);
  if (keys.length !== Object.keys(bx).length) return false;
  return keys.every((k) => Object.prototype.hasOwnProperty.call(bx, k) && sameDocument(ax[k], bx[k]));
}

export function PageEditor({ detail, context, user = null, globals = null, value, onChange, onBindDay, onEditorReady, editable = true, onWidgetSelected }: PageEditorProps) {
  // The slash menu's keydown handler has to be installed at editor creation
  // (`editorProps` is read once), but the menu itself only exists after the
  // editor does. A ref breaks that circle; nothing reads it before the first
  // keystroke, which is long after both are mounted.
  const slashKeyDownRef = useRef<(event: KeyboardEvent) => boolean>(() => false);

  const editor = useEditor({
    extensions: PAGE_EDITOR_EXTENSIONS,
    editorProps: {
      // Drag-and-drop insert. The logic lives in `widgetDrop.ts` — see there
      // for why it is a function rather than a closure (jsdom has no layout,
      // so this handler is unreachable through a rendered editor).
      handleDrop: (view, event) => handleWidgetDrop(view, event as DragEvent),
      handleDOMEvents: {
        dragover: (_view, event) => allowWidgetDragOver(event as DragEvent),
      },
      // Returning true swallows the key, which is the whole point while the
      // slash menu is open: Enter must choose a widget, not split the
      // paragraph. It returns false for every other key and whenever the menu
      // is closed, so ordinary typing is untouched.
      handleKeyDown: (_view, event) => slashKeyDownRef.current(event),
    },
    // A parsed `PageDoc` and TipTap's `JSONContent` describe the same runtime
    // shape; the cast crosses the two representations ADR-038 accepted, and it
    // is safe here for the reason above — the caller proved the vocabulary
    // matches before this mounted.
    content: value as unknown as JSONContent,
    immediatelyRender: false,
    editable,
    onUpdate: ({ editor: updated }) => {
      onChange(updated.getJSON());
    },
  });

  // `editable` is a MOUNT-TIME option, so flipping Reading/Editing later has to
  // be pushed onto the live editor — without this the toggle changes the
  // sidebar and the chrome row but leaves the document itself read-only.
  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  /**
   * **`content` is a mount-time option too, and that was the live-update bug.**
   *
   * Mitchell, 2026-09-22, two devices: one editing the Overview notebook, the
   * other watching the trip's Overview tab. The whole chain worked — the edit
   * became a `PageEdited` event, `headSeq` moved, the poll returned it, and
   * `OverviewLens` re-read the document and set its state. He could see the
   * event arriving in the `/events` response. The tab still showed the old
   * text, because TipTap read `content` once when the editor was created and
   * never looked at the prop again. Exactly the same shape as `editable` above,
   * which already needed this treatment.
   *
   * **Only when NOT editable, and that guard is the important half.** Pushing a
   * new document into an editor somebody is typing in would discard whatever
   * they had written since the fetch — worse than the staleness it fixes, and
   * the reason `KI-2026-09-22-d` says the notebook EDITOR wants a conflict
   * notice rather than a re-read. A read-only view has no in-progress work to
   * lose, so there it is simply correct.
   *
   * **`emitUpdate: false` is load-bearing**, not tidiness. `onUpdate` calls
   * `onChange`, which is what saves — so emitting here would make a reader
   * write back the document they had just been sent, produce another
   * `PageEdited`, and wake every other device to do the same. A loop, at the
   * poll interval, started by reading.
   */
  useEffect(() => {
    if (editor === null || editable) return;
    // **A cheap short-circuit, NOT a correctness guard — proven, not assumed.**
    // Deleting this line fails no test, including one written specifically to
    // catch a rebuild by node identity: ProseMirror parses and DIFFS, so
    // `setContent` with identical content already leaves the rendered nodes
    // alone. What this saves is the parse itself, on every poll, for a document
    // that has not moved. That is worth one comparison and is not worth
    // claiming more for.
    if (sameDocument(editor.getJSON(), value)) return;
    editor.commands.setContent(value as unknown as JSONContent, false);
  }, [editor, editable, value]);

  // Hand the editor up once it exists. `useEditor` returns null on the first
  // render (`immediatelyRender: false`), so this fires twice: null, then the
  // real editor.
  useEffect(() => {
    if (!onEditorReady) return;
    onEditorReady(editor ?? null);
    return () => onEditorReady(null);
  }, [editor, onEditorReady]);

  // The third insert origin. `enabled` is `editable` because Reading offers no
  // insert affordance (§18) — and a read-only document cannot be typed into, so
  // a menu there could never open anyway; saying it out loud keeps the rule in
  // one place rather than relying on that coincidence.
  const slash = useSlashMenu({
    editor,
    enabled: editable,
    onPick: (presetId, range) => {
      // The slash menu lists PRESETS, so what comes back is a preset id;
      // `insertPreset` resolves it to `(primitive, params)` and hands both to
      // `insertWidget`, which is still the one door into a document.
      const built = insertPreset(presetId);
      if (!built.ok) return;
      // Replace the typed `/query` rather than inserting after it, or the
      // document keeps the text that summoned the menu.
      editor?.chain().focus().insertContentAt(range, built.node).run();
    },
  });
  slashKeyDownRef.current = slash.handleKeyDown;

  return (
    <MacroEditorContext.Provider
      value={{ detail, context, user, globals, editing: editable, onBindDay, onWidgetSelected }}
    >
      <EditorContent editor={editor} className="tc-page-editor" />
      <SlashMenu state={slash.state} onPick={slash.onPick} />
    </MacroEditorContext.Provider>
  );
}
