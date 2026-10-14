// **One button for Ask and the trip's chat** (M46's preview walk, Mitchell:
// "I also don't think we need a ask and a chat button, combine everywhere").
// Its name and badge, shared by the header's `AskPill`, the tab bar's Ask and
// the panel's Chat tab. Here beside `phoneAsk.ts` rather than in `assistant/`,
// which imports this folder: the tab bar reading it from there was a cycle.

/**
 * The name of a button that opens Ask and, given `unread`, the trip's chat:
 * "Ask or chat, 3 unread messages". `undefined` where there is no chat: no
 * label, so the visible "Ask" is the name.
 */
export function askOrChatName(unread: number | undefined): string | undefined {
  if (unread === undefined) return undefined;
  return unread === 0 ? "Ask or chat" : `Ask or chat, ${unreadWords(unread)}`;
}

/** "3 unread messages": what an `UnreadBadge` shows, in words for its control's name. */
export function unreadWords(unread: number): string {
  return `${unread} unread ${unread === 1 ? "message" : "messages"}`;
}

/** The unread count drawn on Ask's buttons and the Chat tab; its words are the control's name. */
export function UnreadBadge({ count }: { count: number | undefined }) {
  if (count === undefined || count === 0) return null;
  return (
    <span aria-hidden className="min-w-5 rounded-full bg-brand px-1.5 text-center text-xs leading-5 text-surface">
      {count > 99 ? "99+" : count}
    </span>
  );
}
