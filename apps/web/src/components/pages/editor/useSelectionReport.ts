"use client";
import { useEffect, useId, useMemo, useRef } from "react";
import type { Editor } from "@tiptap/react";
import { useMacroEditorContext } from "./MacroEditorContext";

/**
 * A node view's report to the settings panel (SPEC §26): "I am selected" while
 * it is, and a release when it stops being — or stops existing.
 *
 * Lifted out of `MacroNodeView` when a repeat became a selectable atom with
 * settings of its own (PR #221 preview, 2026-09-24), so the two node views a
 * person configures follow the same rules rather than two copies of them.
 *
 * Returns the node's params, memoised on their value, for the view to render.
 */
export function useSelectionReport(
  selected: boolean,
  name: string,
  rawParams: unknown,
  editor: Editor,
): Record<string, unknown> {
  const { editing, onWidgetSelected } = useMacroEditorContext();
  // **Memoised on its VALUE, not its identity.** `node.attrs.params ?? {}` is a
  // fresh object on every render, and this feeds a `useEffect` that reports the
  // selection upward — so an unmemoised value re-reports on every render, which
  // re-renders the screen, which re-renders this. `PageScreen` also guards
  // against that by value, and both are worth having: this stops the loop at
  // the source, and the guard there stops any other reporter starting one.
  const paramsKey = JSON.stringify(rawParams ?? {});
  const params = useMemo(
    () => (rawParams ?? {}) as Record<string, unknown>,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the serialised value on purpose; `rawParams` is a new object every render and is what this memo exists to stabilise.
    [paramsKey],
  );

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
  // Deleting the selected node destroys this view without `selected` ever
  // going false, so nothing else can say the selection is gone — and
  // `PageScreen` would go on showing the settings of a node that is no longer
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

  const claimedRef = useRef(false);
  useEffect(() => {
    if (!editing || onWidgetSelected === undefined) return;
    if (selected) {
      claimedRef.current = true;
      // The panel writes through `editor` with an attribute step
      // (`blockWidgets.ts`), which keeps this node selected across a rebind.
      // This used to hand up an `updateAttributes` closure, which REPLACES a
      // leaf node, and had to re-select it in a microtask or the panel closed
      // on the first thing you did in it.
      onWidgetSelected({ key, name, params, editor }, key);
      // Deliberately no cleanup that clears: see `PageScreen`, which drops the
      // selection only when the reporting key matches. A cleanup here would run
      // on every params change too, closing the panel the user is typing into.
      return;
    }
    // **Release only what this view claimed.** A view that was never selected
    // has nothing to give up, and saying so is not harmless: since the panel
    // holds every widget of a sentence (§26), rebinding entry 1 changes widget
    // 1's params and re-runs this effect while widget 2 holds the selection —
    // and a flush holding only that "not me" closed the panel under the person
    // using it. Found by the e2e walk for the gate sentence.
    if (!claimedRef.current) return;
    claimedRef.current = false;
    onWidgetSelected(null, key);
    // `params` is in the deps because the panel edits them: a rebind has to
    // reach the open panel, or its controls would show the value from before
    // the change and write it back on the next edit.
  }, [editing, selected, key, name, params, onWidgetSelected, editor]);

  return params;
}
