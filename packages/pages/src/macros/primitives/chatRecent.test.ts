import { describe, expect, it } from "vitest";
import type { ChatMessage, TripDetail } from "@tc/contracts";
import { tripDetailFactory } from "@tc/factories";
import { renderMacro } from "../../registry";
import type { ChatRecentPayload, WidgetContext } from "../../registry-types";

// "Group chat" (M52 decision 15). What a reader cannot check from the screen
// is who the widget is shown to at all (decision 20: never to a share-link
// reader, nor where the chat is not theirs to see) and which three messages it
// picks, so those are what is pinned.

function tripOf(ids: readonly string[]): TripDetail {
  return tripDetailFactory.build(
    { members: ids.map((userId, i) => ({ userId, role: i === 0 ? "owner" : "editor" })) },
    { transient: { dayCount: 1, activitiesPerDay: 0, unscheduledCount: 0 } },
  );
}

let n = 0;
function said(authorId: string, body: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  n += 1;
  return {
    messageId: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    authorId, kind: "member", requestedBy: null, replyTo: null, suggestionId: null, asksAssistant: false,
    createdAt: `2026-10-23T10:${String(n).padStart(2, "0")}:00Z`, editedAt: null, removed: false, body,
    ...extra,
  } as ChatMessage;
}

const trip = tripOf(["dana", "sam"]);
const people = { dana: "Dana Reyes", sam: "Sam Okafor" };
const ctx = (extra: Partial<WidgetContext>): WidgetContext => ({
  trip, page: { tripId: trip.tripId }, user: null, globals: null, today: null, people, ...extra,
});

function chatOf(context: WidgetContext): ChatRecentPayload {
  const outcome = renderMacro(context, "chat.recent", {});
  if (outcome.status !== "ok" || outcome.rendered.kind !== "block" || outcome.rendered.block.kind !== "chat-recent") {
    throw new Error(`expected a chat-recent block, got ${JSON.stringify(outcome)}`);
  }
  return outcome.rendered.block;
}

describe("chat.recent", () => {
  it("shows the last three messages, oldest first, each by its author's name", () => {
    const chat = [said("dana", "Landed!"), said("sam", "On the train"), said("dana", "Dinner at 8?"), said("sam", "Yes")];
    const out = chatOf(ctx({ canChat: true, chat }));
    expect(out.lines?.map((l) => [l.author, l.body])).toEqual([
      ["Sam Okafor", "On the train"],
      ["Dana Reyes", "Dinner at 8?"],
      ["Sam Okafor", "Yes"],
    ]);
  });

  // A removed message has no text to show (the contract gives it none), so
  // it does not take one of the three places.
  it("passes over removed messages, and names the assistant and no one for the app's own lines", () => {
    const chat = [
      said("sam", "Running 20 late"),
      said("assistant", "I moved dinner to 20:30.", { kind: "assistant", requestedBy: "sam" }),
      { ...said("dana", "x"), removed: true } as ChatMessage,
      said("system", "Sam moved Dinner to 20:30", { kind: "system" }),
    ];
    const out = chatOf(ctx({ canChat: true, chat }));
    expect(out.lines?.map((l) => [l.author, l.body])).toEqual([
      ["Sam Okafor", "Running 20 late"],
      ["Assistant", "I moved dinner to 20:30."],
      [null, "Sam moved Dinner to 20:30"],
    ]);
  });

  it("says nothing yet while the chat has not been read, and an empty list once it has", () => {
    expect(chatOf(ctx({ canChat: true, chat: null })).lines).toBeNull();
    expect(chatOf(ctx({ canChat: true, chat: [] })).lines).toEqual([]);
  });

  // Decision 20 and SPEC §27: absent, not disabled. A context that does not
  // say the reader may chat — a share link's, the server's, the invite
  // preview's — gets no widget at all, messages or not.
  it("is absent for a reader who cannot see the chat, and for one whose context never said", () => {
    const chat = [said("dana", "Landed!")];
    expect(renderMacro(ctx({ canChat: false, chat }), "chat.recent", {})).toEqual({ status: "absent" });
    expect(renderMacro(ctx({ chat }), "chat.recent", {})).toEqual({ status: "absent" });
  });
});
