"use client";
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import type { WidgetShape } from "@tc/contracts";
import { getMacro } from "@tc/pages";
import { MacroView } from "../MacroView";
import { useMacroEditorContext } from "./MacroEditorContext";
import { WidgetChrome } from "./WidgetChrome";

// The shape a widget renders as, with the one default both readers of it must
// agree on. `MacroNodeExtension` puts this on the DOM for the stylesheet; the
// node view below uses it to pick a selected state that fits the widget's box.
// A name the registry does not know renders nothing, and `single` is the shape
// that costs the paragraph least while it does.
export function macroShape(name: string): WidgetShape {
  return getMacro(name)?.shape ?? "single";
}

// **The selected state has to be drawn on a box the same shape as the widget.**
//
// KI-2026-09-05-a. A macro node is an inline atom, so `NodeViewWrapper` is an
// inline `<span>`; `ring-2` on an inline box is painted per LINE FRAGMENT. For
// a `single` widget that is exactly right — it is a word in a sentence (SPEC
// §7) and the ring goes round the word. For a `block`/`repeat` widget the
// stylesheet has already made the outer `.react-renderer` element a block
// (`[data-macro-shape="block"] { display: block }`), and the card inside it is
// two stacked flex rows, so the inline wrapper's own fragments are degenerate:
// measured in Chromium on a selected `day.detail`, the wrapper computed
// `display: inline` inside an `outerDisplay: block` card, and the ring rendered
// as two stubs at the card's left and right edges rather than an outline round
// it. ProseMirror HAD selected the node (`.ProseMirror-selectednode` was on the
// outer element) — the feedback saying so was just unreadable, which is what
// made the card feel unselectable.
//
// So a block-shaped wrapper becomes a block box too. That changes no layout —
// its content is already block-level flex rows, so the inline box it used to be
// was only ever a container for them — it only gives the ring a box to hug.
const SELECTED_RING = "ring-2 ring-primary rounded";

// The NodeView for the `macro` ProseMirror node. Renders `MacroView`
// (Task 4.2) — this component owns none of the resolution/rendering logic
// itself, only the TipTap/React wiring: pulling attrs off the node and
// `detail`/`context` off the surrounding editor context.
export function MacroNodeView({ node, selected, updateAttributes }: ReactNodeViewProps) {
  const { detail, context, user, globals, onBindDay, editing } = useMacroEditorContext();
  const name = node.attrs.name as string;
  const params = (node.attrs.params ?? {}) as Record<string, unknown>;
  const className = [macroShape(name) === "single" ? null : "block", selected ? SELECTED_RING : null]
    .filter(Boolean)
    .join(" ");

  return (
    <NodeViewWrapper as="span" className={className || undefined} data-macro-name={name}>
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
