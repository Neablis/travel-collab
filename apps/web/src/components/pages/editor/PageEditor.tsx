"use client";
import { useEditor, EditorContent, type JSONContent } from "@tiptap/react";
import type { TripDetail, PageContext, PageDoc } from "@tc/contracts";
import { PAGE_EDITOR_EXTENSIONS } from "./extensions";
import { MacroEditorContext } from "./MacroEditorContext";

export interface PageEditorProps {
  detail: TripDetail;
  context: PageContext;
  value: PageDoc;
  onChange: (content: unknown) => void;
  onBindDay?: () => void;
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
export function PageEditor({ detail, context, value, onChange, onBindDay }: PageEditorProps) {
  const editor = useEditor({
    extensions: PAGE_EDITOR_EXTENSIONS,
    // A parsed `PageDoc` and TipTap's `JSONContent` describe the same runtime
    // shape; the cast crosses the two representations ADR-038 accepted, and it
    // is safe here for the reason above — the caller proved the vocabulary
    // matches before this mounted.
    content: value as unknown as JSONContent,
    immediatelyRender: false,
    onUpdate: ({ editor: updated }) => {
      onChange(updated.getJSON());
    },
  });

  return (
    <MacroEditorContext.Provider value={{ detail, context, onBindDay }}>
      <EditorContent editor={editor} className="tc-page-editor" />
    </MacroEditorContext.Provider>
  );
}
