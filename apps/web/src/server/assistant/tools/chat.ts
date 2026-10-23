// **`read_chat`: the trip chat, read when the turn needs it** (M52 decision 18).
//
// A turn an `@assistant` in the chat started is asked things like "can you fix
// this problem?", whose problem is in the messages before it. The chat is not
// put into the turn's context up front: the model calls this when it needs the
// conversation, and only such a turn is offered it (`origins`).
import { z } from "zod";
import { ChatMessageKind, type ChatLink, type TripDetail } from "@tc/contracts";
import { defineTool } from "@/server/assistant/defineTool";
import { CHAT_CONTEXT_MESSAGES, MAX_CHAT_CHARS_PER_MESSAGE, MAX_CHAT_MESSAGES_READ } from "@/server/assistant/limits";
import { untrusted, untrustedOrNull } from "@/server/assistant/prompt";

export const READ_CHAT_TOOL_NAME = "read_chat";

const ReadChatInput = z.object({
  // Not `.max()`: a larger number is capped, not refused, so a model that asks
  // for more than the ceiling still gets an answer.
  limit: z.number().int().min(1).optional(),
});

const ReadChatOutput = z.object({
  messages: z.array(
    z.object({
      // Ours, so never fenced: a member can name themselves "Assistant", and
      // this is how the model tells its own earlier replies from theirs.
      authorKind: ChatMessageKind,
      author: z.string(),
      at: z.string(),
      text: z.string().nullable(),
      about: z.string().optional(),
    }),
  ),
});
type ReadChatOutput = z.infer<typeof ReadChatOutput>;

/** How many messages a call reads: the default when unset, never past the ceiling. */
export function chatReadLimit(asked: number | undefined): number {
  return Math.min(asked ?? CHAT_CONTEXT_MESSAGES, MAX_CHAT_MESSAGES_READ);
}

/** One message's text, cut at the character cap. */
function clip(text: string): string {
  return text.length <= MAX_CHAT_CHARS_PER_MESSAGE ? text : `${text.slice(0, MAX_CHAT_CHARS_PER_MESSAGE - 1)}…`;
}

/**
 * A linked day or stop by the name the model reads it by elsewhere: "Day 3",
 * a stop's title. Nothing for one since deleted, or for a notebook or person,
 * which `read_trip` has no name for either.
 */
function aboutOf(trip: TripDetail, link: ChatLink | undefined): string | undefined {
  if (link?.kind === "day") {
    const index = trip.days.findIndex((day) => day.dayId === link.id);
    return index < 0 ? undefined : `Day ${index + 1}`;
  }
  if (link?.kind === "stop") return trip.activities[link.id]?.title;
  return undefined;
}

export const readChatTool = defineTool({
  name: READ_CHAT_TOOL_NAME,
  description:
    'Read the trip chat\'s latest messages, oldest first: who wrote each (`authorKind` says whether a member or you), when, what it says and the day or stop it points at. Call it when the request refers to something said in the chat ("fix this problem", "what we talked about"). Leave `limit` unset.',
  domain: "itinerary",
  effect: "read",
  spend: "none",
  input: ReadChatInput,
  output: ReadChatOutput,
  // Members write every line of it, so each name, word and title is fenced.
  taint: (readout: ReadChatOutput): ReadChatOutput => ({
    messages: readout.messages.map((line) => ({
      authorKind: line.authorKind,
      author: untrusted(line.author),
      at: line.at,
      text: untrustedOrNull(line.text),
      ...(line.about === undefined ? {} : { about: untrusted(line.about) }),
    })),
  }),
  needs: ["chatLog", "trip"] as const,
  minimumRole: "viewer",
  origins: ["chat"],
  run: async (input, deps) => ({
    messages: (await deps.chatLog.recent(chatReadLimit(input.limit))).map(({ link, text, ...line }) => {
      const cut = text === null ? null : clip(text);
      const about = aboutOf(deps.trip, link);
      return about === undefined ? { ...line, text: cut } : { ...line, text: cut, about };
    }),
  }),
});

export const CHAT_TOOLS = [readChatTool] as const;
