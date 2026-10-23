"use client";
import type { ChatRecentPayload } from "@tc/pages";
import { usePhoneAsk } from "@/components/nav/phoneAsk";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";

// "Group chat" (M52 decision 15): the last three messages, then *Open chat*,
// which opens the panel on Chat through the screen that holds it
// (`PhoneAskEntry.chat`). While the page is being edited the button would be a
// control that does nothing, so it is not drawn.
//
// Spans rather than `<div>`s, `TripStripBlock`'s reason: a widget node is an
// inline atom and renders inside a paragraph.
/** Group chat: the newest messages, and a way into the conversation. */
export function ChatRecentBlock({ payload, interactive = true }: { payload: ChatRecentPayload; interactive?: boolean }) {
  const openChat = usePhoneAsk()?.chat?.onOpen;
  return (
    <span role="group" aria-label="Group chat" className="flex flex-col gap-2">
      {payload.lines === null ? null : payload.lines.length === 0 ? (
        <Text as="span" variant="secondary">
          No messages yet.
        </Text>
      ) : (
        <span role="list" className="flex flex-col gap-1">
          {payload.lines.map((line) => (
            <span role="listitem" key={line.messageId} className="truncate text-sm">
              {line.author === null ? null : <span className="font-medium text-ink">{line.author}: </span>}
              <span className="text-slate">{line.body}</span>
            </span>
          ))}
        </span>
      )}
      {interactive && openChat ? (
        <span>
          <Button size="sm" onClick={openChat}>
            Open chat
          </Button>
        </span>
      ) : null}
    </span>
  );
}
