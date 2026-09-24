"use client";
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import type { WidgetShape } from "@tc/contracts";
import { getMacro } from "@tc/pages";
import { MacroView } from "../MacroView";
import { useMacroEditorContext } from "./MacroEditorContext";
import type { WidgetMarkSpec } from "./widgetMarkPlugin";
import { useSelectionReport } from "./useSelectionReport";

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
// two stacked flex rows, so the inline wrapper's own fragments are degenerate.
//
// So a block-shaped wrapper becomes a block box too. That changes no layout —
// its content is already block-level flex rows — it only gives the ring a box
// to hug.
// `ring-brand`, and the name matters. This shipped as `ring-primary` — shadcn's
// default ring colour, which this app never defined: `globals.css` sets
// `--color-*: initial`, so an unknown utility emits nothing and the ring fell
// back to `currentColor` instead of the brand. Caught by the token wall
// (`KI-2026-09-19-g`), not by a test, because no layer here can assert a paint.
export const SELECTED_RING = "ring-2 ring-brand rounded";

// SPEC §26's edit-mode affordance, and the whole of what edit mode adds to the
// document:
//
// > a dashed outline around each widget block, a small 58×20 handle on its top
// > edge carrying a ▸ (the widget's name is the tooltip, and the heading of the
// > panel that opens), and the block itself as the click target. Outline and
// > handle sit outside the text measure, so **the prose does not move**.
//
// `.tc-widget-handle` (globals.css) is what keeps the handle out of the flow —
// it is absolutely positioned against the wrapper, which is why the wrapper is
// `relative` in edit mode for every shape now, not only for blocks.
const EDIT_OUTLINE = "tc-widget-edit relative";

/**
 * Renders a macro node inside the editor, and reports its selection outwards.
 *
 * The rendering is the smaller half. This node view is also the only thing that
 * knows a widget is selected, and SPEC §26 puts every widget control in a side
 * channel that has to be told: so a selected node reports its params and its
 * editor up through the editor context, and a selected node that UNMOUNTS
 * reports its own release — deleting a widget destroys this
 * view without `selected` ever going false, which would otherwise leave the
 * panel holding a node that is gone (CodeRabbit, PR 170).
 *
 * The `@param` list this replaces named `node`, `selected` and
 * `updateAttributes` and said of each what its own name says. None of the above
 * is visible in the signature, which is what a docstring here is for.
 */
export function MacroNodeView({ node, selected, editor, decorations }: ReactNodeViewProps) {
  const { detail, context, user, globals, external, onBindDay, editing } = useMacroEditorContext();
  const name = node.attrs.name as string;
  const params = useSelectionReport(selected, name, node.attrs.params, editor);
  const def = getMacro(name);

  // The number that ties this widget to its entry in the settings panel (§26:
  // *"numbered to match the marks in the text"*). It arrives as a decoration
  // from `widgetMarkPlugin`, not from reading the document here: a node view
  // is only re-rendered when ITS node or decorations change, so a sibling
  // inserted earlier in the sentence would leave a number computed here stale.
  const mark = decorations.find((d) => typeof (d.spec as WidgetMarkSpec).widgetMark === "number")?.spec as
    | WidgetMarkSpec
    | undefined;

  const className = [
    macroShape(name) === "single" ? null : "block",
    editing ? EDIT_OUTLINE : null,
    // **The ring is an EDITING affordance, so Reading does not draw it.**
    // ProseMirror will happily select an atom in a read-only document, and this
    // used to ring it — while the settings panel stayed shut, because the
    // effect above reports nothing outside Editing and `PageScreen` gates the
    // sheet on it. Mitchell, on the preview: *"wheres the edit ui when I select
    // the widget?"* The honest answer was that there is none in Reading (§18 —
    // Reading is the traveller's view), and the ring was promising one.
    editing && selected ? SELECTED_RING : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <NodeViewWrapper as="span" className={className || undefined} data-macro-name={name}>
      {/* Editing only, and OUTSIDE the text measure (§26). It is not a button:
          a focusable control inside a ProseMirror atom competes with the node
          selection that is the actual click target, and §26 makes "the block
          itself" the target. The name lives in the `title`, which is what §26
          asks for — a bare ▸ on the handle, the name as its tooltip.

          The handle is also where the widget's NUMBER goes, when its block
          holds more than one. The design draws it as a superscript after the
          value; in the flow, that would move the prose on entering Editing,
          which is the one thing §26 says Editing must never do. The handle is
          already out of the flow. As bare text rather than a nested span: a
          span in here is one more element for anything looking for the
          widget's own output to trip over (`m14-mobile-notebook`'s `widget()`
          locator is exactly that). */}
      {editing ? (
        <span className="tc-widget-handle" title={def?.title ?? name} aria-hidden data-testid="widget-handle">
          ▸{mark?.widgetMark}
        </span>
      ) : null}
      <MacroView detail={detail} context={context} user={user} globals={globals} external={external} name={name} params={params} onBindDay={onBindDay} editing={editing} />
    </NodeViewWrapper>
  );
}
