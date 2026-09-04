"use client";
import { useEditor, EditorContent, type Editor, type JSONContent } from "@tiptap/react";
import { useEffect, useRef } from "react";
import type { TripDetail, PageContext, PageDoc, TripGlobals, UserPreferences } from "@tc/contracts";
import { insertPreset } from "@tc/pages";
import { PAGE_EDITOR_EXTENSIONS } from "./extensions";
import { MacroEditorContext } from "./MacroEditorContext";
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
export function PageEditor({ detail, context, user = null, globals = null, value, onChange, onBindDay, onEditorReady, editable = true }: PageEditorProps) {
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
    <MacroEditorContext.Provider value={{ detail, context, user, globals, editing: editable, onBindDay }}>
      <EditorContent editor={editor} className="tc-page-editor" />
      <SlashMenu state={slash.state} onPick={slash.onPick} />
    </MacroEditorContext.Provider>
  );
}
