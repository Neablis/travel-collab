import { describe, expect, it } from "vitest";
import type { ChatMessage, TripDetail } from "@tc/contracts";
import { tripDetailFactory } from "@tc/factories";
import { renderMacro } from "../../registry";
import type { ChatRecentPayload, WidgetContext } from "../../registry-types";
import { chatRecent } from "./chatRecent";

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

function chatOf(context: WidgetContext, params: Record<string, unknown> = {}): ChatRecentPayload {
  const outcome = renderMacro(context, "chat.recent", params);
  if (outcome.status !== "ok" || outcome.rendered.kind !== "block" || outcome.rendered.block.kind !== "chat-recent") {
    throw new Error(`expected a chat-recent block, got ${JSON.stringify(outcome)}`);
  }
  return outcome.rendered.block;
}

describe("chat.recent", () => {
  it("shows the last three messages, oldest first, each by its author's name", () => {
    const chat = [said("dana", "Landed!"), said("sam", "On the train"), said("dana", "Dinner at 8?"), said("sam", "Yes")];
    const out = chatOf(ctx({ canChat: true, chat }));
    expect(out.lines?.map((l) => [l.author, l.message.body])).toEqual([
      ["Sam Okafor", "On the train"],
      ["Dana Reyes", "Dinner at 8?"],
      ["Sam Okafor", "Yes"],
    ]);
  });

  // A removed message has no text to show (the contract gives it none), so
  // it does not take one of the three places.
  // A change line is stored as the server writes it (`postSystemLine`): its
  // author is whoever made the change, and its body only what was done, so
  // the name in front of it is the widget's to give, as the chat panel does.
  it("passes over removed messages, and names the assistant and whoever made a change", () => {
    const chat = [
      said("sam", "Running 20 late"),
      said("assistant", "I moved dinner to 20:30.", { kind: "assistant", requestedBy: "sam" }),
      { ...said("dana", "x"), removed: true } as ChatMessage,
      said("dana", "moved “Dinner” to 20:30", { kind: "system" }),
    ];
    const out = chatOf(ctx({ canChat: true, chat }));
    expect(out.lines?.map((l) => [l.author, l.message.body])).toEqual([
      ["Sam Okafor", "Running 20 late"],
      ["Assistant", "I moved dinner to 20:30."],
      ["Dana Reyes", "moved “Dinner” to 20:30"],
    ]);
  });

  // The assistant writes under an id no member has: counted as a former
  // member, it would number the one real leaver beside it.
  it("names someone who has left as the one former member beside the assistant's line", () => {
    const chat = [
      said("left-trip", "See you all at home"),
      said("assistant", "Done.", { kind: "assistant", requestedBy: "sam" }),
      said("sam", "moved “Dinner” to 20:30", { kind: "system" }),
    ];
    expect(chatOf(ctx({ canChat: true, chat })).lines?.[0]?.author).toBe("Former member");
  });

  // The chat panel never numbers a leaver (PR 537 round 8), and a number here
  // would be an index into the shown window, so it would shift as it slides.
  it("names every leaver as the chat panel does, unnumbered, however many are shown", () => {
    const chat = [said("ana", "See you"), said("ben", "Bye"), said("ben", "moved “Dinner” to 20:30", { kind: "system" })];
    expect(chatOf(ctx({ canChat: true, chat })).lines?.map((l) => l.author)).toEqual(["Former member", "Former member", "Former member"]);
  });

  // Mitchell, on PR 537's round 3: how many it shows is the widget's setting,
  // three unless chosen, and between one and ten.
  describe("how many messages it shows", () => {
    const chat = Array.from({ length: 12 }, (_, i) => said(i % 2 === 0 ? "dana" : "sam", `Message ${i + 1}`));
    const shown = (params: Record<string, unknown>) => chatOf(ctx({ canChat: true, chat }), params).lines?.map((l) => l.message.body);

    it("shows the number chosen in its settings", () => {
      expect(shown({ count: "5" })).toEqual(["Message 8", "Message 9", "Message 10", "Message 11", "Message 12"]);
    });

    // A page written by hand or by the assistant can store anything here, and
    // a broken widget is worse than the default (PR 537 round 4).
    it.each([[{}], [{ count: "lots" }], [{ count: null }], [{ count: true }], [{ count: " " }]])(
      "shows three when what is stored is not a number: %j",
      (params) => {
        expect(shown(params)).toEqual(["Message 10", "Message 11", "Message 12"]);
      },
    );

    it("holds a stored number outside one to ten at the nearer end", () => {
      expect(shown({ count: 0 })).toEqual(["Message 12"]);
      expect(shown({ count: "40" })).toHaveLength(10);
    });

    it("offers one to ten in its settings, three first chosen", () => {
      const input = chatRecent.inputs.find((i) => i.name === "count");
      expect(input).toMatchObject({ type: "choice", default: "3" });
      expect(input?.type === "choice" && input.options.map((o) => o.value)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
    });
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
