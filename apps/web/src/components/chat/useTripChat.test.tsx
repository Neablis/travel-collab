import { renderHook, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { ChatMessage, type ChatPage } from "@tc/contracts";
import { uuidFrom } from "@tc/factories";
import { useTripChat } from "./useTripChat";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const TRIP = uuidFrom(46);
// Parsed, so a message here is the contract's shape and cannot drift from it.
const message = (n: number, authorId = "u-bea") =>
  ChatMessage.parse({
    messageId: uuidFrom(n, 46),
    authorId,
    createdAt: `2026-10-13T10:0${n}:00.000Z`,
    editedAt: null,
    removed: false,
    body: `message ${n}`,
  });
const pageOf = (messages: ChatMessage[]): ChatPage => ({ messages, hasEarlier: false, unread: messages.length, canPost: true });

describe("useTripChat", () => {
  // M46 D1: a message shows on every open page without a refresh, and the
  // poll's `chatRev` is the only thing that tells this page there is one.
  it("reads the conversation again when chatRev moves, and not before", async () => {
    let served = pageOf([message(1)]);
    server.use(http.get(`/api/trips/${TRIP}/chat`, () => HttpResponse.json(served)));
    const { result, rerender } = renderHook((chatRev: string | null) => useTripChat({ tripId: TRIP, enabled: true, chatRev, reading: false }), {
      initialProps: "1",
    });
    await waitFor(() => expect(result.current.messages.map((m) => m.messageId)).toEqual([message(1).messageId]));

    served = pageOf([message(1), message(2)]);
    rerender("2");
    await waitFor(() => expect(result.current.messages.map((m) => m.messageId)).toEqual([message(1).messageId, message(2).messageId]));
    expect(result.current.unread).toBe(2);
  });

  // M46 D2: a removed member's open page does not otherwise learn it was
  // removed (KI-2026-10-05-h); the chat says so instead of looking live.
  it("is no-access when the server answers 403", async () => {
    server.use(http.get(`/api/trips/${TRIP}/chat`, () => HttpResponse.json({ error: "forbidden" }, { status: 403 })));
    const { result } = renderHook(() => useTripChat({ tripId: TRIP, enabled: true, chatRev: null, reading: false }));
    await waitFor(() => expect(result.current.status).toBe("no-access"));
  });
});
