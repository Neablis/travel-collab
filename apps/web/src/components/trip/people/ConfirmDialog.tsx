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
  return (
    <Dialog open onOpenChange={onOpenChange} title={title}>
      <Text variant="secondary">{body}</Text>
      <DialogFooter>
        <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button variant="destructive" size="sm" disabled={busy} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
