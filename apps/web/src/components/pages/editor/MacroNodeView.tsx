"use client";
import { useEffect, useId, useMemo, useRef } from "react";
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import type { WidgetShape } from "@tc/contracts";
import { getMacro } from "@tc/pages";
import { MacroView } from "../MacroView";
import { useMacroEditorContext } from "./MacroEditorContext";

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
const SELECTED_RING = "ring-2 ring-primary rounded";

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
 * Renders a macro node and synchronizes its editable selection with the
 * surrounding page.
 *
 * Selected widgets report their parameters and updater through context.
 * Parameter updates reselect the node so its settings stay open, and
 * unmounting a selected node clears that report.
 */
export function MacroNodeView({ node, selected, updateAttributes, editor, getPos }: ReactNodeViewProps) {
  const { detail, context, user, globals, onBindDay, editing, onWidgetSelected } = useMacroEditorContext();
  const name = node.attrs.name as string;
  // **Memoised on its VALUE, not its identity.** `node.attrs.params ?? {}` is a
  // fresh object on every render, and this feeds a `useEffect` that reports the
  // selection upward — so an unmemoised value re-reports on every render, which
  // re-renders the screen, which re-renders this. `PageScreen` also guards
  // against that by value, and both are worth having: this stops the loop at
  // the source, and the guard there stops any other reporter starting one.
  const rawParams = node.attrs.params;
  const paramsKey = JSON.stringify(rawParams ?? {});
  const params = useMemo(
    () => (rawParams ?? {}) as Record<string, unknown>,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the serialised value on purpose; `rawParams` is a new object every render and is what this memo exists to stabilise.
    [paramsKey],
  );
  const def = getMacro(name);

  // Stable for the life of this mounted node view, and the reason the surface
  // can tell "this widget deselected" from "a different widget selected
  // instead". Without it, two node views racing their effects — the old one
  // clearing as the new one sets — can clear the selection that was just made,
  // and which one wins depends on React's effect order rather than on what the
  // user clicked.
  const key = useId();

  // **The one report this view owes on the way out: it was selected, and now it
  // does not exist.**
  //
  // Deleting the selected widget destroys this view without `selected` ever
  // going false, so nothing else can say the selection is gone — and
  // `PageScreen` would go on showing the settings of a widget that is no longer
  // in the document, writing its edits back through an `onChange` closed over a
  // dead node (CodeRabbit, PR 170).
  //
  // Through REFS, with `key` as the only dependency, so this runs on unmount
  // and on nothing else. The selection effect below deliberately re-runs on
  // every params change — a rebind is a params change — and a cleanup sharing
  // those deps would fire a clear every time somebody used the panel, which is
  // the bug the comment in `PageScreen` records as the second shape this went
  // through. A remount's clear is harmless anyway: a claim beats a release in
  // the same flush, and the remounted view claims immediately.
  const selectedRef = useRef(selected);
  const reporterRef = useRef(onWidgetSelected);
  selectedRef.current = selected;
  reporterRef.current = onWidgetSelected;
  useEffect(
    () => () => {
      if (selectedRef.current) reporterRef.current?.(null, key);
    },
    [key],
  );

  useEffect(() => {
    if (!editing || onWidgetSelected === undefined) return;
    if (selected) {
      onWidgetSelected(
        {
          key,
          name,
          params,
          onChange: (next) => {
            updateAttributes({ params: next });
            // **Re-select this node afterwards, or the panel closes on the
            // first thing you do in it.**
            //
            // `updateAttributes` replaces the node in the document, and a
            // `NodeSelection` pointing at the old one does not survive that —
            // ProseMirror maps the selection to a text position beside it. So
            // `selected` went false, this view reported null, and the settings
            // panel unmounted the moment a binding was picked. That was
            // invisible while the controls lived in the flow (SPEC §26 moved
            // them out) because nothing there depended on the selection.
            //
            // Deferred a tick: the re-selection has to run against the document
            // the update produced, not the one it was dispatched from.
            queueMicrotask(() => {
              const pos = getPos();
              if (pos === undefined) return;
              const at = editor.state.doc.nodeAt(pos);
              if (at?.type.name !== "macro") return;
              editor.commands.setNodeSelection(pos);
            });
          },
        },
        key,
      );
      // Deliberately no cleanup that clears: see `PageScreen`, which drops the
      // selection only when the reporting key matches. A cleanup here would run
      // on every params change too, closing the panel the user is typing into.
      return;
    }
    onWidgetSelected(null, key);
    // `params` is in the deps because the panel edits them: a rebind has to
    // reach the open panel, or its selects would show the value from before the
    // change and write it back on the next edit.
  }, [editing, selected, key, name, params, updateAttributes, onWidgetSelected, editor, getPos]);

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
          asks for — a bare ▸ on the handle, the name as its tooltip. */}
      {editing ? (
        <span className="tc-widget-handle" title={def?.title ?? name} aria-hidden data-testid="widget-handle">
          ▸
        </span>
      ) : null}
      <MacroView detail={detail} context={context} user={user} globals={globals} name={name} params={params} onBindDay={onBindDay} />
    </NodeViewWrapper>
  );
}
