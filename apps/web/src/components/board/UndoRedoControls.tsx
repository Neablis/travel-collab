"use client";

import { useEffect } from "react";
import { Redo2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    target.closest("input, textarea, select, [contenteditable]") !== null
  );
}

// The ⌘Z / ⇧⌘Z bindings, split out from the buttons on purpose.
//
// The buttons moved inside the History popover (Mitchell, preview feedback on
// PR #55: "In the designs, the next/previous history button was moved into
// the history dropdown at the top"), and popover content only mounts while
// the popover is open. Had the shortcut stayed inside the button component it
// would have gone with them — undo would work only while History was open,
// which is a silent regression no test was watching for. TripHeader calls
// this hook itself, at a level that is always mounted.
export function useUndoRedoShortcuts({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  isBusy = false,
}: {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  isBusy?: boolean;
}) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      if (isTypingTarget(e.target)) return;
      if (isBusy) return;
      e.preventDefault();
      if (e.shiftKey) {
        if (canRedo) onRedo();
      } else if (canUndo) {
        onUndo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canUndo, canRedo, onUndo, onRedo, isBusy]);
}

// The buttons only. Renders wherever the caller puts it — today, inside the
// History popover above the entries list. Binds no keys itself; see
// useUndoRedoShortcuts above.
export function UndoRedoControls({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  isBusy = false,
}: {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** True while a compensating command (undo/redo) is in flight. Guards against
   * a rapid double-click firing two overlapping commands against the same
   * expectedSeq. */
  isBusy?: boolean;
}) {
  return (
    <span className="flex gap-0.5">
      <Button variant="ghost" size="sm" onClick={onUndo} disabled={!canUndo || isBusy} aria-label="Undo" title="Undo (⌘Z)">
        <Undo2 className="size-3.5" aria-hidden />
        Undo
      </Button>
      <Button variant="ghost" size="sm" onClick={onRedo} disabled={!canRedo || isBusy} aria-label="Redo" title="Redo (⇧⌘Z)">
        <Redo2 className="size-3.5" aria-hidden />
        Redo
      </Button>
    </span>
  );
}
