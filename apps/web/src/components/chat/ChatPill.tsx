"use client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

/** "Chat", or "Chat, 3 unread": the count is in the name, not only in the badge. */
export function chatPillName(unread: number): string {
  return unread > 0 ? `Chat, ${unread} unread` : "Chat";
}

/**
 * The trip's chat, opened from the header (M46 layout, D5): beside Ask on a
 * desktop, as `AskPill` is drawn; on the phone's row, `compact`, an icon with
 * the count. The count is the unread messages by other people.
 *
 * Hidden by width with CSS by the caller, never `useIsPhone()`, for the
 * first-paint reason `AskPill` gives.
 */
export function ChatPill({
  unread,
  open,
  onOpen,
  compact = false,
  className,
}: {
  unread: number;
  open: boolean;
  onOpen: () => void;
  compact?: boolean;
  className?: string;
}) {
  return (
    <Button
      variant="ghost"
      size="md"
      className={cn(
        "shrink-0 gap-1.5 rounded-full font-semibold",
        compact ? "max-md:min-w-11 max-md:px-2" : "bg-brand-tint text-brand-pressed hover:bg-brand-tint hover:text-brand-pressed",
        className,
      )}
      aria-label={chatPillName(unread)}
      aria-expanded={open}
      data-testid={compact ? "chat-pill-phone" : "chat-pill"}
      onClick={onOpen}
    >
      <span aria-hidden>💬</span>
      {!compact && <span aria-hidden>Chat</span>}
      {unread > 0 && (
        <span aria-hidden className="min-w-5 rounded-full bg-brand px-1.5 text-xs leading-5 text-surface">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Button>
  );
}
