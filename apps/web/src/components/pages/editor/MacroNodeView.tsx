"use client";
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { MacroView } from "../MacroView";
import { useMacroEditorContext } from "./MacroEditorContext";
import { WidgetChrome } from "./WidgetChrome";

// The NodeView for the `macro` ProseMirror node. Renders `MacroView`
// (Task 4.2) — this component owns none of the resolution/rendering logic
// itself, only the TipTap/React wiring: pulling attrs off the node and
// `detail`/`context` off the surrounding editor context.
export function MacroNodeView({ node, selected, updateAttributes }: ReactNodeViewProps) {
  const { detail, context, user, globals, onBindDay, editing } = useMacroEditorContext();
  const name = node.attrs.name as string;
  const params = (node.attrs.params ?? {}) as Record<string, unknown>;

  return (
    <NodeViewWrapper as="span" className={selected ? "ring-2 ring-primary rounded" : undefined} data-macro-name={name}>
      <MacroView detail={detail} context={context} user={user} globals={globals} name={name} params={params} onBindDay={onBindDay} />
      {/* Editing only. The rebind writes straight onto the node's attrs, which
          is what makes this the whole flow: ProseMirror updates the document,
          `onUpdate` fires, and the page autosaves — no separate save path and
          no second place a binding could live. */}
      {editing ? (
        <WidgetChrome
          name={name}
          params={params}
          detail={detail}
          globals={globals}
          onChange={(next) => updateAttributes({ params: next })}
        />
      ) : null}
    </NodeViewWrapper>
  );
}
