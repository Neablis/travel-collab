// **One button for Ask and the trip's chat** (M46's preview walk, Mitchell:
// "I also don't think we need a ask and a chat button, combine everywhere").
// Its name and unread dot, shared by the header's `AskPill`, the tab bar's Ask and
// the panel's Chat tab. Here beside `phoneAsk.ts` rather than in `assistant/`,
// which imports this folder: the tab bar reading it from there was a cycle.

import { cn } from "@/lib/cn";

/**
 * The name of a button that opens Ask and, given `unread`, the trip's chat:
 * "Ask or chat, 3 unread messages". `undefined` where there is no chat: no
 * label, so the visible "Ask" is the name.
 */
export function askOrChatName(unread: number | undefined): string | undefined {
  if (unread === undefined) return undefined;
  return unread === 0 ? "Ask or chat" : `Ask or chat, ${unreadWords(unread)}`;
}

/** "3 unread messages": the count an `UnreadDot` stands for, in words for its control's name. */
export function unreadWords(unread: number): string {
  return `${unread} unread ${unread === 1 ? "message" : "messages"}`;
}

/**
 * The mark for unread messages on Ask's buttons and the Chat tab: a dot, not
 * the count, and out of flow, so its control never changes size when one
 * arrives (Mitchell, M46 walk: "the rest as just the unread dot"; Home's cards
 * keep the count). `className` places it on a `relative` box; the count is in
 * the control's name.
 */
export function UnreadDot({ className, testId = "unread-dot" }: { className: string; testId?: string }) {
  return (
    <span
      aria-hidden
      data-testid={testId}
      className={cn("pointer-events-none absolute size-2.5 rounded-full bg-brand ring-2 ring-surface", className)}
    />
  );
}
