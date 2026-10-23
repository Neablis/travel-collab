"use client";
import Link from "next/link";
import { useId } from "react";
import type { ChatRecentPayload } from "@tc/pages";
import { usePhoneAsk } from "@/components/nav/phoneAsk";
import { Button, buttonVariants } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/cn";

// "Group chat" (M52 decision 15): the last few messages, and the whole widget
// is the way into the conversation (Mitchell, PR 537 round 3): one control that
// opens the chat where it lives, through the screen that knows where that is
// (`PhoneAskEntry.chat`). A button where that is the screen's own panel, a
// link where it is another page, so it opens in a new tab (PR 537 round 4).
// While the page is being edited a click selects the widget as it does any
// other, so it is drawn as plain text then.
//
// Its name is a caption it shows, not an `aria-label` over the messages
// (WCAG 2.5.3, PR 537 round 4): a voice user says what they see, a sighted
// one is told it opens something, and while the chat is still being read the
// control is not an empty one.
//
// Spans rather than `<div>`s, `TripStripBlock`'s reason: a widget node is an
// inline atom and renders inside a paragraph. No list roles: a control's
// content is presentational, so the lines are its description instead.
/** Group chat: the newest messages, opening the conversation. */
export function ChatRecentBlock({ payload, interactive = true }: { payload: ChatRecentPayload; interactive?: boolean }) {
  const chat = usePhoneAsk()?.chat;
  const captionId = useId();
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
  if (!interactive || chat === undefined) {
    return (
      <span role="group" aria-label="Group chat" className="flex flex-col gap-1">
        {lines}
      </span>
    );
  }
  const control = {
    "aria-labelledby": captionId,
    "aria-describedby": lines === null ? undefined : linesId,
    className: "h-auto w-full flex-col items-stretch justify-start gap-1 px-2 py-1.5 text-left font-normal",
  };
  const content = (
    <>
      <span id={captionId} className="text-xs font-medium text-slate">
        Open group chat
      </span>
      {lines === null ? null : (
        <span id={linesId} className="flex flex-col gap-1">
          {lines}
        </span>
      )}
    </>
  );
  return "href" in chat ? (
    <Link href={chat.href} {...control} className={cn(buttonVariants({ variant: "ghost" }), control.className)}>
      {content}
    </Link>
  ) : (
    <Button variant="ghost" onClick={chat.onOpen} {...control}>
      {content}
    </Button>
  );
}
