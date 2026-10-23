import { z } from "zod";
import type { ChatMessage } from "@tc/contracts";
import type { ChatRecentLine, ChatRecentPayload, MacroDef, WidgetContext } from "../../registry-types";
import { blockOf } from "../../registry-types";
import { ok, needsTrip, type MacroResult } from "../../result";
import { personNames } from "./balances";

// `chat.recent` — "Group chat" (M52 decision 15): the last three messages and
// a way into the conversation. **A registered widget, not a primitive**, for
// `trip.people`'s reason: there is no entity to narrow.
//
// It is shown only to a reader who can see the chat (`requires`, decision 20),
// and reads the messages the screen already holds (`WidgetContext.chat`). The
// way in, *Open chat*, is the renderer's: it is a control, not data.

const ChatRecentParams = z.object({});
type ChatRecentParams = z.infer<typeof ChatRecentParams>;

/** The design's three: enough to tell what is being talked about, and no more. */
const SHOWN = 3;

/** What the chat panel calls the assistant's replies. */
const ASSISTANT = "Assistant";

function lineOf(message: Extract<ChatMessage, { removed: false }>, names: ReadonlyMap<string, string>): ChatRecentLine {
  const author = message.kind === "assistant" ? ASSISTANT : message.kind === "system" ? null : names.get(message.authorId)!;
  return { messageId: message.messageId, author, body: message.body };
}

export const chatRecent: MacroDef<ChatRecentParams, ChatRecentPayload> = {
  name: "chat.recent",
  title: "Group chat",
  shape: "block",
  params: ChatRecentParams,
  inputs: [],
  selection: undefined,
  requires: "canChat",
  description: "The trip's group chat: its last three messages, and a way to open the conversation. Shown only to people who can see the chat.",
  emptyText: "no messages yet",
  // Fixed, never computed (ADR-037 decision 5): nobody's words.
  preview: "the last three messages, and Open chat",
  resolve: ({ trip, people, guests, chat }: WidgetContext, _params): MacroResult<ChatRecentPayload> => {
    if (!trip) return needsTrip();
    if (chat == null) return ok({ kind: "chat-recent", lines: null });
    // A removed message has no text (the contract gives it none), so it does
    // not take one of the places.
    const shown = chat.filter((m): m is Extract<ChatMessage, { removed: false }> => !m.removed).slice(-SHOWN);
    const names = personNames(trip, people, shown.map((m) => m.authorId), guests);
    return ok({ kind: "chat-recent", lines: shown.map((m) => lineOf(m, names)) });
  },
  render: blockOf,
};
