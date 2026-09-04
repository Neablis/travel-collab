"use client";
import { useEditor, EditorContent, type Editor, type JSONContent } from "@tiptap/react";
import { useEffect } from "react";
import StarterKit from "@tiptap/starter-kit";
import type { TripDetail, PageContext, PageContent, TripGlobals, UserPreferences } from "@tc/contracts";
import { MacroNodeExtension } from "./MacroNodeExtension";
import { MacroEditorContext } from "./MacroEditorContext";

export interface PageEditorProps {
  detail: TripDetail;
  context: PageContext;
  user?: UserPreferences | null;
  globals?: TripGlobals | null;
  value: PageContent;
  onChange: (content: PageContent) => void;
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
export function PageEditor({ detail, context, user = null, globals = null, value, onChange, onBindDay, onEditorReady, editable = true }: PageEditorProps) {
  const editor = useEditor({
    // Macro AUTHORING left the primary surface in M8 (seven macros is not a
    // vocabulary; the block renderers never had a design pass). RENDERING stays
    // registered on purpose: page content is stored ProseMirror JSON, so
    // unregistering this extension would silently DROP existing macro nodes on the
    // next save. The authoring vocabulary returns in M14.
    extensions: [StarterKit, MacroNodeExtension],
    // `PageContent` (`@tc/contracts`) is a permissive zod-validated doc shape;
    // TipTap's `Content` type wants a plain `JSONContent`. They describe the
    // same runtime shape (a ProseMirror/TipTap doc), so the cast is safe —
    // the editor's own schema is the real validator of what's inside.
    content: value as unknown as JSONContent,
    immediatelyRender: false,
    editable,
    onUpdate: ({ editor: updated }) => {
      onChange(updated.getJSON() as PageContent);
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

  return (
    <MacroEditorContext.Provider value={{ detail, context, user, globals, editing: editable, onBindDay }}>
      <EditorContent editor={editor} className="tc-page-editor" />
    </MacroEditorContext.Provider>
  );
}
