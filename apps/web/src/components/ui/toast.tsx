"use client";
import { useEffect } from "react";
import { X } from "lucide-react";
import { Button } from "./button";
import { Text } from "./text";
import { cn } from "@/lib/cn";

// A15's whole toast surface: `role="status"` so screen readers announce it
// without stealing focus (unlike alertdialog — same non-alert precedent as
// Dialog/Sheet elsewhere in this file family), one optional action (Undo),
// and an auto-dismiss timer so it never has to be a persistent fixture. No
// stacking/queueing — this milestone only ever shows one at a time, fired
// from local component state in the caller (page.tsx, SettingsSheet).
const AUTO_DISMISS_MS = 8000;

export function Toast({
  message,
  actionLabel,
  onAction,
  onDismiss,
  className,
}: {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss: () => void;
  className?: string;
}) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div
      role="status"
      className={cn(
        "fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-hairline bg-surface px-4 py-2.5 shadow-overlay",
        className,
      )}
    >
      <Text as="span" variant="secondary" className="text-ink">
        {message}
      </Text>
      {actionLabel && onAction && (
        <Button variant="ghost" size="sm" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
      <Button variant="ghost" size="icon" aria-label="Dismiss" onClick={onDismiss}>
        <X className="size-3.5" aria-hidden />
      </Button>
    </div>
  );
}
