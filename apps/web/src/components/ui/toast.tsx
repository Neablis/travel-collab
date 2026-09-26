"use client";
import { useEffect, useRef } from "react";
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
// SPEC §27: *"The toast holds 6s when it carries an action, 2.4s when it does
// not."* One flat 8s before this, which is the wrong shape in both directions —
// too long to read "Saved", and an arbitrary amount of time to notice an Undo
// and reach it. A toast you can act on has to outlast the moment you realise
// you want to; one you cannot act on only has to be read.
const AUTO_DISMISS_WITH_ACTION_MS = 6000;
const AUTO_DISMISS_MS = 2400;

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
  // The timer's lifetime must be independent of `onDismiss`'s identity: both
  // call sites (page.tsx, TripHeader.tsx) pass an inline arrow function, which
  // is a new reference on every render of the parent — depending on it here
  // would tear down and restart the countdown on any unrelated parent
  // re-render (typing in the trip-name field, any context update), and in the
  // worst case the toast would never auto-dismiss. A ref holds the latest
  // callback so the timer can always call the current one without needing it
  // in the dependency array.
  //
  // `message` IS a legitimate restart trigger, though: page.tsx's toast state
  // can be overwritten by a second delete (a different trip) while the first
  // trip's toast is still showing, without ever passing through null — same
  // component instance, new props, no remount — so the new message needs its
  // own full-length timer rather than inheriting whatever was left of the
  // previous one.
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  // **One boolean, read by the timer and by the markup below.** The longer
  // countdown exists to give someone time to press the button; the gate was
  // `actionLabel === undefined` while the BUTTON's gate was `actionLabel &&
  // onAction`, so a label handed in without a handler rendered nothing and
  // still bought six seconds of a toast with nothing to do (CodeRabbit, PR
  // 170). Deriving both from the same value is what stops the two drifting
  // apart again.
  //
  // Safe in the dependency list where `onAction` itself would not be: a
  // caller's inline arrow is a new reference every render, and `Boolean` of it
  // is not.
  const hasAction = Boolean(actionLabel && onAction);

  useEffect(() => {
    const timer = setTimeout(
      () => onDismissRef.current(),
      hasAction ? AUTO_DISMISS_WITH_ACTION_MS : AUTO_DISMISS_MS,
    );
    return () => clearTimeout(timer);
  }, [message, hasAction]);

  return (
    <div
      role="status"
      // Tests need a way to find this specifically — `role="status"` alone
      // stopped being unique once SyncIndicator (KI-5, M8) added a second
      // one to the same header.
      data-testid="toast"
      className={cn(
        // `toast-dock` is the bottom offset: 16px above whatever else owns the
        // bottom of the screen — the unscheduled rack and the phone tab bar —
        // rather than above the viewport's edge (globals.css).
        "toast-dock fixed left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-hairline bg-surface px-4 py-2.5 shadow-overlay",
        className,
      )}
    >
      <Text as="span" variant="secondary" className="text-ink">
        {message}
      </Text>
      {hasAction && (
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
