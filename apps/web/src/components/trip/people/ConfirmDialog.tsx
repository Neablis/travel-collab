"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Text } from "@/components/ui/text";

/**
 * A small confirm for a People action that cannot be taken back from here —
 * revoke, remove, leave. `body` says what happens, in the consequence's own
 * words (spec §4), so the button can be a plain verb.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  busy,
  onOpenChange,
  onConfirm,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  // **Nothing closes it while `busy`** — Cancel, the ✕ or Esc. The request is
  // already out, and closing would not stop it: a leave cancelled mid-flight
  // still sent the reader home from a dialog they had dismissed.
  const openChange = (open: boolean) => {
    if (!open && busy) return;
    onOpenChange(open);
  };
  return (
    <Dialog open onOpenChange={openChange} title={title}>
      <Text variant="secondary">{body}</Text>
      <DialogFooter>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => openChange(false)}>
          Cancel
        </Button>
        <Button variant="destructive" size="sm" disabled={busy} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
