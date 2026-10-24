"use client";
import { useId, type ReactNode } from "react";
import { ChevronRight, MessageCircle } from "lucide-react";
import type { ChatRecentLine, ChatRecentPayload } from "@tc/pages";
import { ChangeLine, MessageFace } from "@/components/chat/ChatMessage";
import { MessageBody } from "@/components/chat/MessageChip";
import { usePhoneAsk } from "@/components/nav/phoneAsk";
import { unreadWords } from "@/components/nav/askOrChat";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/cn";
import type { Persona } from "@/lib/persona";
import { usePersonas } from "../people";

// "Trip chat" (M52 decision 15), as a mini chat card (Mitchell, PR 537
// preview walk): a "Trip chat" header, the last few messages drawn by the
// chat's own `MessageFace` and `ChangeLine`, so they look as they do in the
// chat, and an "Open chat" footer. The whole card is one button into the
// conversation, opening the screen's own panel on Chat in place, on the board
// and on a notebook alike (`PhoneAskEntry.chat`; Mitchell, PR 537).
// Nothing inside it is a control: a message's link is drawn as its words.
// While the page is being edited a click selects the widget as it does any
// other, so the card is drawn but is no control then. On a solo trip there is
// no chat to open, so it is never a control: the same header, and a line
// saying how to get one (Mitchell, PR 537 walk, 2026-10-24).
//
// Its name is the header and the footer it shows (WCAG 2.5.3): a voice user
// says what they see. The unread count and the messages describe it.
//
// Spans rather than `<div>`s, `TripStripBlock`'s reason: a widget node is an
// inline atom and renders inside a paragraph.
/** Trip chat: the newest messages as a card that opens the conversation. */
export function ChatRecentBlock({ payload, interactive = true }: { payload: ChatRecentPayload; interactive?: boolean }) {
  const chat = usePhoneAsk()?.chat;
  const personas = usePersonas();
  const titleId = useId();
  const footerId = useId();
  const linesId = useId();
  const unreadId = useId();
  const unread = chat?.unread ?? 0;

  const content = (
    <>
      <span className="flex items-center gap-2 border-b border-hairline px-3 py-2">
        <MessageCircle aria-hidden className="size-4 shrink-0 text-slate" />
        <span id={titleId} className="text-sm font-semibold text-ink">
          Trip chat
        </span>
        {unread > 0 && <span id={unreadId} className="ml-auto text-xs font-medium text-brand">{unreadWords(unread)}</span>}
      </span>
      {payload.solo ? (
        <span className="px-3 py-2.5">
          <Text as="span" variant="secondary">
            Add other travelers to see the trip chat
          </Text>
        </span>
      ) : payload.lines === null ? null : (
        <span id={linesId} className="flex flex-col gap-3 px-3 py-2.5">
          {payload.lines.length === 0 ? (
            <Text as="span" variant="secondary">
              No messages yet
            </Text>
          ) : (
            payload.lines.map((line) => <Line key={line.message.messageId} line={line} persona={personas?.[line.message.authorId]} />)
          )}
        </span>
      )}
      {!payload.solo && (
        <span className="flex items-center justify-between border-t border-hairline px-3 py-2 text-sm font-medium text-brand">
          <span id={footerId}>Open chat</span>
          <ChevronRight aria-hidden className="size-4" />
        </span>
      )}
    </>
  );

  const card = "flex w-full flex-col overflow-hidden rounded-md border border-hairline bg-surface text-left";
  if (!interactive || payload.solo || chat === undefined) {
    return (
      <span role="group" aria-labelledby={titleId} className={card}>
        {content}
      </span>
    );
  }
  const control = {
    "aria-labelledby": `${titleId} ${footerId}`,
    // The unread count is drawn in the header but is neither label, so it
    // is said here; the name stays exactly the words a voice user sees.
    "aria-describedby": [unread > 0 ? unreadId : null, payload.lines === null ? null : linesId].filter(Boolean).join(" ") || undefined,
    className: cn(card, "h-auto items-stretch justify-start gap-0 p-0 font-normal whitespace-normal"),
  };
  return (
    <Button variant="ghost" onClick={chat.onOpen} {...control}>
      {content}
    </Button>
  );
}

/** One message as the chat draws it, read-only; the app's own change line as the chat's quiet one. */
function Line({ line, persona }: { line: ChatRecentLine; persona: Persona | undefined | null }): ReactNode {
  const { message, author } = line;
  if (message.kind === "system") return <ChangeLine message={message} name={author} as="span" />;
  return (
    <span className="flex gap-2">
      <MessageFace name={author} persona={persona} message={message} as="span">
        <span className="line-clamp-2 break-words text-sm text-ink">
          <MessageBody body={message.body} />
        </span>
      </MessageFace>
    </span>
  );
}
