import { z } from "zod";
import type { ChatMessage } from "@tc/contracts";
import type { ChatRecentLine, ChatRecentPayload, MacroDef, WidgetContext } from "../../registry-types";
import { blockOf } from "../../registry-types";
import { ok, needsTrip, type MacroResult } from "../../result";
import { personNames } from "./balances";

// `chat.recent` — "Group chat" (M52 decision 15): the last few messages, as
// many as its settings say, and a way into the conversation. **A registered widget, not a primitive**, for
// `trip.people`'s reason: there is no entity to narrow.
//
// It is shown only to a reader who can see the chat (`requires`, decision 20),
// and reads the messages the screen already holds (`WidgetContext.chat`). The
// way in, the whole widget opening the chat, is the renderer's: it is a
// control, not data.

/** The design's three: enough to tell what is being talked about, and no more. */
export const CHAT_RECENT_DEFAULT = 3;
/** The most a reader may choose (Mitchell, PR 537 round 3): past ten it is the chat itself. */
const MOST = 10;

// A `choice` stores its value as a string; a number is taken too, for a page
// written by hand. Anything else, or nothing, is the default rather than a
// broken widget, so the schema takes any value and `countOf` judges it (PR 537
// round 4): a number outside one to ten is held at the nearer end.
const ChatRecentParams = z.object({ count: z.unknown().optional() });
type ChatRecentParams = z.infer<typeof ChatRecentParams>;

function countOf(stored: unknown): number {
  // Only a string or a number names a count: `Number(true)` is 1 and
  // `Number(" ")` is 0, neither of which anyone chose.
  const text = typeof stored === "number" ? String(stored) : typeof stored === "string" ? stored.trim() : "";
  const n = text === "" ? NaN : Math.round(Number(text));
  return Number.isFinite(n) ? Math.min(MOST, Math.max(1, n)) : CHAT_RECENT_DEFAULT;
}

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
  inputs: [
    {
      name: "count", type: "choice", label: "Messages shown", default: String(CHAT_RECENT_DEFAULT),
      options: Array.from({ length: MOST }, (_, i) => ({ value: String(i + 1), label: String(i + 1) })),
    },
  ],
  selection: undefined,
  requires: "canChat",
  description: `The trip's group chat: its last messages (${CHAT_RECENT_DEFAULT} unless \`count\` says 1 to ${MOST}), and opening it opens the conversation. Shown only to people who can see the chat.`,
  emptyText: "no messages yet",
  // Fixed, never computed (ADR-037 decision 5): nobody's words.
  preview: "the last few messages, opening the chat",
  resolve: ({ trip, people, guests, chat }: WidgetContext, params): MacroResult<ChatRecentPayload> => {
    if (!trip) return needsTrip();
    if (chat == null) return ok({ kind: "chat-recent", lines: null });
    // A removed message has no text (the contract gives it none), so it does
    // not take one of the places.
    const shown = chat.filter((m): m is Extract<ChatMessage, { removed: false }> => !m.removed).slice(-countOf(params.count));
    // Members' ids only: the assistant's and the app's are no member's, and
    // `personNames` would count them as former members and number a real one.
    const authors = shown.filter((m) => m.kind === "member").map((m) => m.authorId);
    const names = personNames(trip, people, authors, guests);
    return ok({ kind: "chat-recent", lines: shown.map((m) => lineOf(m, names)) });
  },
  render: blockOf,
};
