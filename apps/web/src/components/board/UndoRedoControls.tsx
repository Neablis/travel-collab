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

  return (
    <span className="flex gap-0.5">
      <Button variant="ghost" size="icon" onClick={onUndo} disabled={!canUndo || isBusy} aria-label="Undo" title="Undo (⌘Z)">
        <Undo2 className="size-3.5" aria-hidden />
      </Button>
      <Button variant="ghost" size="icon" onClick={onRedo} disabled={!canRedo || isBusy} aria-label="Redo" title="Redo (⇧⌘Z)">
        <Redo2 className="size-3.5" aria-hidden />
      </Button>
    </span>
  );
}
