"use client";
import { useId } from "react";
import type { ChatRecentPayload } from "@tc/pages";
import { usePhoneAsk } from "@/components/nav/phoneAsk";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";

// "Group chat" (M52 decision 15): the last few messages, and the whole widget
// is the way into the conversation (Mitchell, PR 537 round 3): one button that
// opens the chat where it lives, through the screen that knows where that is
// (`PhoneAskEntry.chat`). While the page is being edited a click selects the
// widget as it does any other, so it is drawn as plain text then.
//
// Spans rather than `<div>`s, `TripStripBlock`'s reason: a widget node is an
// inline atom and renders inside a paragraph. No list roles: a button's
// content is presentational, so the lines are its description instead.
/** Group chat: the newest messages, opening the conversation. */
export function ChatRecentBlock({ payload, interactive = true }: { payload: ChatRecentPayload; interactive?: boolean }) {
  const openChat = usePhoneAsk()?.chat?.onOpen;
  const linesId = useId();
  const lines =
    payload.lines === null ? null : payload.lines.length === 0 ? (
      <Text as="span" variant="secondary">
        No messages yet.
      </Text>
    ) : (
      payload.lines.map((line) => (
        <span key={line.messageId} className="block truncate text-sm">
          {line.author === null ? null : <span className="font-medium text-ink">{line.author}: </span>}
          <span className="text-slate">{line.body}</span>
        </span>
      ))
    );
  if (!interactive || openChat === undefined) {
    return (
      <span role="group" aria-label="Group chat" className="flex flex-col gap-1">
        {lines}
      </span>
    );
  }
  return (
    <Button
      variant="ghost"
      aria-label="Open group chat"
      aria-describedby={linesId}
      onClick={openChat}
      className="h-auto w-full flex-col items-stretch justify-start px-2 py-1.5 text-left font-normal"
    >
      <span id={linesId} className="flex flex-col gap-1">
        {lines}
      </span>
    </Button>
  );
}
