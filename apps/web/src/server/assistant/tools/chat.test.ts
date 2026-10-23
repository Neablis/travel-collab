// `read_chat` (M52 decision 18). How many messages it reads is two numbers in
// `limits.ts`, kept there so they can be tuned without touching the tool: the
// mock below moves them, and the tool has to move with them.
import { describe, expect, it, vi } from "vitest";
import { tripDetailFactory } from "@tc/factories";
import type { ChatLine, ChatLog } from "@/server/assistant/deps";
import { untrusted } from "@/server/assistant/prompt";
import { readChatTool } from "./chat";

vi.mock("@/server/assistant/limits", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/assistant/limits")>()),
  CHAT_CONTEXT_MESSAGES: 7,
  MAX_CHAT_MESSAGES_READ: 9,
  MAX_CHAT_CHARS_PER_MESSAGE: 20,
}));

const trip = tripDetailFactory.build({}, { transient: { dayCount: 2, activitiesPerDay: 1 } });

/** A chat log that records each limit it was asked for, and answers `lines`. */
function chatLog(lines: ChatLine[] = []): ChatLog & { asked: number[] } {
  const asked: number[] = [];
  return { asked, recent: async (limit) => (asked.push(limit), lines) };
}

describe("read_chat", () => {
  it("reads limits.ts's default when the model leaves limit unset, and never past its ceiling", async () => {
    const log = chatLog();
    await readChatTool.invoke({}, { chatLog: log, trip });
    await readChatTool.invoke({ limit: 3 }, { chatLog: log, trip });
    await readChatTool.invoke({ limit: 500 }, { chatLog: log, trip });
    expect(log.asked).toEqual([7, 3, 9]);
  });

  // Any member can paste long messages, and the readout is re-sent on every
  // later step of the asker's paid turn: each one is cut at limits.ts's cap.
  it("cuts a long message at limits.ts's character cap", async () => {
    const log = chatLog([{ authorKind: "member", author: "Sam", at: "2027-04-01T09:00:00.000Z", text: "abcdefghijklmnopqrstuvwxyz" }]);
    const { messages } = await readChatTool.invoke({}, { chatLog: log, trip });
    expect(messages[0]!.text).toBe(untrusted("abcdefghijklmnopqrs…"));
  });

  // A member can name themselves "Assistant", so the name is fenced and the
  // kind, which is ours, is not: it is how the model tells its own replies.
  it("names the day and stop a message links, fences what members wrote, and says who is the assistant", async () => {
    const day = trip.days[1]!;
    const stopId = day.activityIds[0]!;
    const log = chatLog([
      { authorKind: "member", author: "Sam", at: "2027-04-01T09:00:00.000Z", text: "the museum is shut", link: { kind: "stop", id: stopId } },
      { authorKind: "member", author: "Assistant", at: "2027-04-01T09:01:00.000Z", text: "move it?", link: { kind: "day", id: day.dayId } },
      { authorKind: "assistant", author: "Assistant", at: "2027-04-01T09:02:00.000Z", text: null },
    ]);
    const { messages } = await readChatTool.invoke({}, { chatLog: log, trip });
    expect(messages).toEqual([
      {
        authorKind: "member",
        author: untrusted("Sam"),
        at: "2027-04-01T09:00:00.000Z",
        text: untrusted("the museum is shut"),
        about: untrusted(trip.activities[stopId]!.title),
      },
      {
        authorKind: "member",
        author: untrusted("Assistant"),
        at: "2027-04-01T09:01:00.000Z",
        text: untrusted("move it?"),
        about: untrusted("Day 2"),
      },
      { authorKind: "assistant", author: untrusted("Assistant"), at: "2027-04-01T09:02:00.000Z", text: null },
    ]);
  });
});
