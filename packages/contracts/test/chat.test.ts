import { describe, expect, it } from "vitest";
import { CHAT_MESSAGE_MAX, ChatMessage, ChatPage, PostChatMessage, TripEventsPage } from "../src/index.ts";

const meta = {
  messageId: "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f",
  authorId: "dev-alice",
  createdAt: "2026-10-13T10:00:00.000Z",
  editedAt: null,
};

describe("ChatMessage", () => {
  // ADR-073 §4: a removed message is served with no text. The variant is what
  // stops a server that forgot to blank the row from sending it anyway.
  it("drops the body and link of a removed message", () => {
    const parsed = ChatMessage.parse({
      ...meta,
      removed: true,
      body: "the thing I deleted",
      link: { kind: "day", id: meta.messageId },
    });
    expect(parsed).toEqual({ ...meta, removed: true });
  });

  it("keeps the body and link of a live message", () => {
    const live = { ...meta, removed: false, body: "Dinner at 8?", link: { kind: "stop", id: meta.messageId } };
    expect(ChatMessage.parse(live)).toEqual(live);
  });
});

describe("PostChatMessage", () => {
  it("trims, and refuses a body that is empty after trimming or over the limit", () => {
    expect(PostChatMessage.parse({ body: "  hi  " }).body).toBe("hi");
    expect(PostChatMessage.safeParse({ body: "   " }).success).toBe(false);
    expect(PostChatMessage.safeParse({ body: "x".repeat(CHAT_MESSAGE_MAX + 1) }).success).toBe(false);
  });

  it("links only a day or a stop", () => {
    const link = { kind: "page", id: meta.messageId };
    expect(PostChatMessage.safeParse({ body: "hi", link }).success).toBe(false);
  });
});

describe("ChatPage", () => {
  it("names why a member may not post", () => {
    const page = { messages: [], hasEarlier: false, unread: 0, canPost: false, readOnlyReason: "collaborators-not-entitled" };
    expect(ChatPage.parse(page)).toEqual(page);
    expect(ChatPage.safeParse({ ...page, readOnlyReason: "because" }).success).toBe(false);
  });
});

describe("TripEventsPage.chatRev", () => {
  // ADR-073 §2: rides the poll beside `accessRev`, optional for version skew.
  it("is optional, and a non-empty string when present", () => {
    const page = { headSeq: 3, events: [], resync: false };
    expect(TripEventsPage.parse(page).chatRev).toBeUndefined();
    expect(TripEventsPage.parse({ ...page, chatRev: "2" }).chatRev).toBe("2");
    expect(TripEventsPage.safeParse({ ...page, chatRev: "" }).success).toBe(false);
  });
});
