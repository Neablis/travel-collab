"use client";
import { useEditor, EditorContent, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { TripDetail, PageContext, PageContent, UserPreferences } from "@tc/contracts";
import { MacroNodeExtension } from "./MacroNodeExtension";
import { MacroEditorContext } from "./MacroEditorContext";

export interface PageEditorProps {
  detail: TripDetail;
  context: PageContext;
  user?: UserPreferences | null;
  value: PageContent;
  onChange: (content: PageContent) => void;
  onBindDay?: () => void;
}

// The rich-text editor for a page: StarterKit's usual marks/blocks, plus the
// `macro` atom node. `detail`/`context` reach each macro's NodeView via
// `MacroEditorContext`, not extension `storage` — see that file for why
// (storage updates aren't reactive; a Provider re-render is).
export function PageEditor({ detail, context, user = null, value, onChange, onBindDay }: PageEditorProps) {
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
    onUpdate: ({ editor: updated }) => {
      onChange(updated.getJSON() as PageContent);
    },
  });

  return (
    <MacroEditorContext.Provider value={{ detail, context, user, onBindDay }}>
      <EditorContent editor={editor} className="tc-page-editor" />
    </MacroEditorContext.Provider>
  );
}
