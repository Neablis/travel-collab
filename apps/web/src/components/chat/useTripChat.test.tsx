import { renderHook, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { ChatMessage, type ChatPage } from "@tc/contracts";
import { uuidFrom } from "@tc/factories";
import { useTripChat } from "./useTripChat";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  vi.useRealTimers();
  server.resetHandlers();
});
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
    let reads = 0;
    server.use(
      http.get(`/api/trips/${TRIP}/chat`, () => {
        reads += 1;
        return HttpResponse.json(served);
      }),
    );
    // Faked from before the mount, so a timer the hook set up is one this
    // test can run; advancing with real time too, so `waitFor` still waits.
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval"], shouldAdvanceTime: true });
    const { result, rerender } = renderHook((chatRev: string | null) => useTripChat({ tripId: TRIP, enabled: true, chatRev, reading: false, accessLost: false }), {
      initialProps: "1",
    });
    await waitFor(() => expect(result.current.messages.map((m) => m.messageId)).toEqual([message(1).messageId]));

    // The same revision, and a minute of timers: D4 rules out a timer of the
    // chat's own, so neither may read again.
    rerender("1");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(reads).toBe(1);
    vi.useRealTimers();

    served = pageOf([message(1), message(2)]);
    rerender("2");
    await waitFor(() => expect(result.current.messages.map((m) => m.messageId)).toEqual([message(1).messageId, message(2).messageId]));
    expect(result.current.unread).toBe(2);
  });

  // M46 D2: a removed member's open page does not otherwise learn it was
  // removed (KI-2026-10-05-h); the chat says so instead of looking live.
  it("is no-access when the server answers 403", async () => {
    server.use(http.get(`/api/trips/${TRIP}/chat`, () => HttpResponse.json({ error: "forbidden" }, { status: 403 })));
    const { result } = renderHook(() => useTripChat({ tripId: TRIP, enabled: true, chatRev: null, reading: false, accessLost: false }));
    await waitFor(() => expect(result.current.status).toBe("no-access"));
  });

  // The other way a removed member learns it: their events poll is refused,
  // and nothing moves `chatRev` for them again, so without this the panel
  // keeps a live composer until they press Send (PR 436 review, finding 3).
  it("is no-access once the trip's poll is refused, without a post", async () => {
    server.use(
      http.get(`/api/trips/${TRIP}/chat`, () => HttpResponse.json(pageOf([message(1)]))),
      http.post(`/api/trips/${TRIP}/chat/read`, () => new HttpResponse(null, { status: 204 })),
    );
    const { result, rerender } = renderHook((accessLost: boolean) => useTripChat({ tripId: TRIP, enabled: true, chatRev: "1", reading: true, accessLost }), {
      initialProps: false,
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    rerender(true);
    expect(result.current.status).toBe("no-access");
  });

  // M46 D5: reading the Chat tab moves the server's read cursor to the newest
  // message, or the 💬 counts them all again once the panel closes.
  it("marks the newest message read while reading, and again when a newer one arrives", async () => {
    let served = pageOf([message(1)]);
    const marked: unknown[] = [];
    server.use(
      http.get(`/api/trips/${TRIP}/chat`, () => HttpResponse.json(served)),
      http.post(`/api/trips/${TRIP}/chat/read`, async ({ request }) => {
        marked.push(await request.json());
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { rerender } = renderHook((chatRev: string) => useTripChat({ tripId: TRIP, enabled: true, chatRev, reading: true, accessLost: false }), {
      initialProps: "1",
    });
    await waitFor(() => expect(marked).toEqual([{ messageId: message(1).messageId }]));

    served = pageOf([message(1), message(2)]);
    rerender("2");
    await waitFor(() => expect(marked).toEqual([{ messageId: message(1).messageId }, { messageId: message(2).messageId }]));
  });
});
