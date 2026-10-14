import { act, renderHook, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { ChatMessage, type ChatPage } from "@tc/contracts";
import { uuidFrom } from "@tc/factories";
import { useTripChat } from "./useTripChat";

// The reader, whose own sent lines these are.
vi.mock("@/components/account/useSessionUser", () => ({ useKnownSessionUser: () => ({ id: "u-me" }) }));

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

  // M46 D6: an edit or a delete shows on the author's own line at once, from
  // the server's answer, not on the next poll; the other pages get it by
  // `chatRev`.
  it("puts the server's answer to an edit and a delete in place of the line", async () => {
    const id = message(1).messageId;
    server.use(
      http.get(`/api/trips/${TRIP}/chat`, () => HttpResponse.json(pageOf([message(1), message(2)]))),
      http.patch(`/api/trips/${TRIP}/chat/${id}`, async ({ request }) => {
        const { body } = (await request.json()) as { body: string };
        return HttpResponse.json({ message: { ...message(1), body, editedAt: "2026-10-13T11:00:00.000Z" } });
      }),
      http.delete(`/api/trips/${TRIP}/chat/${id}`, () => {
        const { messageId, authorId, createdAt } = message(1);
        return HttpResponse.json({ message: { messageId, authorId, createdAt, editedAt: null, removed: true } });
      }),
    );
    const { result } = renderHook(() => useTripChat({ tripId: TRIP, enabled: true, chatRev: "1", reading: false, accessLost: false }));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    await act(async () => expect(await result.current.edit(id, "Train at ten?")).toBe(true));
    expect(result.current.messages[0]).toMatchObject({ body: "Train at ten?", editedAt: "2026-10-13T11:00:00.000Z" });

    await act(async () => expect(await result.current.remove(id)).toBe(true));
    expect(result.current.messages.map((m) => m.removed)).toEqual([true, false]);
  });

  // Mitchell's M46 walk: a sent message waited on the POST before it showed.
  // It shows at once now, and goes again if the server does not store it.
  describe("a sent message", () => {
    // The POST answers only when the test says so, once it has arrived.
    const sending = () => {
      let arrived: (answer: (response: Response) => void) => void = () => {};
      const request = new Promise<(response: Response) => void>((resolve) => (arrived = resolve));
      server.use(http.post(`/api/trips/${TRIP}/chat`, () => new Promise<Response>((resolve) => arrived(resolve))));
      return async (response: Response) => (await request)(response);
    };
    const ids = (messages: readonly { messageId: string }[]) => messages.map((m) => m.messageId);

    // The read cursor takes only ids the server made: the pending line's is
    // this page's own, and the stored message is marked once it is in.
    it("is in the conversation before the server answers, and is marked read only once stored", async () => {
      const mine = message(2, "u-me");
      const marked: unknown[] = [];
      server.use(
        http.get(`/api/trips/${TRIP}/chat`, () => HttpResponse.json(pageOf([message(1)]))),
        http.post(`/api/trips/${TRIP}/chat/read`, async ({ request }) => {
          marked.push(await request.json());
          return new HttpResponse(null, { status: 204 });
        }),
      );
      const answer = sending();
      const { result } = renderHook(() => useTripChat({ tripId: TRIP, enabled: true, chatRev: "1", reading: true, accessLost: false }));
      await waitFor(() => expect(marked).toHaveLength(1));

      act(() => void result.current.post("Train at nine?"));
      expect(result.current.messages.at(-1)).toMatchObject({ body: "Train at nine?", pending: true });

      await act(() => answer(HttpResponse.json({ message: mine }, { status: 201 })));
      await waitFor(() => expect(marked).toEqual([{ messageId: message(1).messageId }, { messageId: mine.messageId }]));
    });

    it("is taken back when the server does not store it", async () => {
      server.use(http.get(`/api/trips/${TRIP}/chat`, () => HttpResponse.json(pageOf([message(1)]))));
      const answer = sending();
      const { result } = renderHook(() => useTripChat({ tripId: TRIP, enabled: true, chatRev: "1", reading: false, accessLost: false }));
      await waitFor(() => expect(result.current.status).toBe("ready"));

      let unsent = Promise.resolve<string | null>(null);
      act(() => void (unsent = result.current.post("Train at nine?")));
      expect(result.current.messages).toHaveLength(2);
      await act(async () => {
        await answer(HttpResponse.json({ error: "Something went wrong." }, { status: 500 }));
        expect(await unsent).toBe("Train at nine?");
      });
      expect(ids(result.current.messages)).toEqual([message(1).messageId]);
      expect(result.current.postError).toBe("Something went wrong.");
    });

    // The poll can bring the stored message back before the POST answers, and
    // does again after: either way it is one line, where the pending one was.
    it("becomes the server's message once, however the re-reads land", async () => {
      const mine = message(2, "u-me");
      let served = pageOf([message(1)]);
      let reads = 0;
      server.use(
        http.get(`/api/trips/${TRIP}/chat`, () => {
          reads += 1;
          return HttpResponse.json(served);
        }),
      );
      const answer = sending();
      const { result, rerender } = renderHook((chatRev: string) => useTripChat({ tripId: TRIP, enabled: true, chatRev, reading: false, accessLost: false }), {
        initialProps: "1",
      });
      await waitFor(() => expect(result.current.status).toBe("ready"));

      let unsent = Promise.resolve<string | null>("not answered");
      act(() => void (unsent = result.current.post("message 2")));
      served = pageOf([message(1), mine]);
      rerender("2");
      await waitFor(() => expect(reads).toBe(2));
      expect(ids(result.current.messages)).toEqual([message(1).messageId, mine.messageId]);
      await act(async () => {
        await answer(HttpResponse.json({ message: mine }, { status: 201 }));
        expect(await unsent).toBeNull();
      });
      expect(ids(result.current.messages)).toEqual([message(1).messageId, mine.messageId]);

      // Waits on read 3's answer, which brings a third message, not on the
      // request: the line it checks held before that answer landed.
      served = pageOf([message(1), mine, message(3)]);
      rerender("3");
      await waitFor(() => expect(ids(result.current.messages)).toContain(message(3).messageId));
      expect(ids(result.current.messages)).toEqual([message(1).messageId, mine.messageId, message(3).messageId]);
    });

    // Two sends with the same words: the first stored stands in for one of
    // them, and the other stays pending until its own arrives.
    it("gives one pending line way for each stored message with its words", async () => {
      const stored = { ...message(2, "u-me"), body: "ok" };
      let served = pageOf([message(1)]);
      server.use(http.get(`/api/trips/${TRIP}/chat`, () => HttpResponse.json(served)));
      sending();
      const { result, rerender } = renderHook((chatRev: string) => useTripChat({ tripId: TRIP, enabled: true, chatRev, reading: false, accessLost: false }), {
        initialProps: "1",
      });
      await waitFor(() => expect(result.current.status).toBe("ready"));

      act(() => {
        void result.current.post("ok");
        void result.current.post("ok");
      });
      served = pageOf([message(1), stored]);
      rerender("2");
      await waitFor(() => expect(ids(result.current.messages)).toContain(stored.messageId));
      expect(ids(result.current.messages)).toEqual([message(1).messageId, stored.messageId, "pending-2"]);
    });

    // A same-worded message of the reader's from before the send is not this
    // one: the pending line stays until its own arrives.
    it("keeps the pending line beside an earlier message with the same words", async () => {
      const earlier = { ...message(1, "u-me"), body: "ok" };
      server.use(http.get(`/api/trips/${TRIP}/chat`, () => HttpResponse.json(pageOf([earlier]))));
      sending();
      const { result } = renderHook(() => useTripChat({ tripId: TRIP, enabled: true, chatRev: "1", reading: false, accessLost: false }));
      await waitFor(() => expect(result.current.status).toBe("ready"));

      act(() => void result.current.post("ok"));
      expect(result.current.messages.map((m) => m.messageId)).toEqual([earlier.messageId, "pending-1"]);
    });

    // Two sends in one POST's latency: each shows at once, and the second is
    // not sent until the first is stored, so the server stamps them in order.
    describe("two in quick succession", () => {
      const twoSends = () => {
        const arrived: string[] = [];
        const answers: ((response: Response) => void)[] = [];
        server.use(
          http.get(`/api/trips/${TRIP}/chat`, () => HttpResponse.json(pageOf([message(1)]))),
          http.post(`/api/trips/${TRIP}/chat`, async ({ request }) => {
            arrived.push(((await request.json()) as { body: string }).body);
            return new Promise<Response>((resolve) => answers.push(resolve));
          }),
        );
        return { arrived, answer: (n: number, response: Response) => answers[n]!(response) };
      };

      it("are sent one after the other, in the order sent", async () => {
        const { arrived, answer } = twoSends();
        const { result } = renderHook(() => useTripChat({ tripId: TRIP, enabled: true, chatRev: "1", reading: false, accessLost: false }));
        await waitFor(() => expect(result.current.status).toBe("ready"));

        act(() => {
          void result.current.post("Train at nine?");
          void result.current.post("or ten?");
        });
        expect(result.current.messages.map((m) => !m.removed && m.body)).toEqual(["message 1", "Train at nine?", "or ten?"]);
        await waitFor(() => expect(arrived).toEqual(["Train at nine?"]));
        // Long enough for a second POST to arrive, were it already sent.
        await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
        expect(arrived).toEqual(["Train at nine?"]);

        await act(async () => answer(0, HttpResponse.json({ message: { ...message(2, "u-me"), body: "Train at nine?" } }, { status: 201 })));
        await waitFor(() => expect(arrived).toEqual(["Train at nine?", "or ten?"]));
      });

      it("go back together when the first is not stored, and the second is never sent", async () => {
        const { arrived, answer } = twoSends();
        const { result } = renderHook(() => useTripChat({ tripId: TRIP, enabled: true, chatRev: "1", reading: false, accessLost: false }));
        await waitFor(() => expect(result.current.status).toBe("ready"));

        let first = Promise.resolve<string | null>(null);
        let second = Promise.resolve<string | null>("not answered");
        act(() => {
          first = result.current.post("Train at nine?");
          second = result.current.post("or ten?");
        });
        await waitFor(() => expect(arrived).toHaveLength(1));
        await act(async () => {
          answer(0, HttpResponse.error());
          expect(await first).toBe("Train at nine? or ten?");
          expect(await second).toBeNull();
        });
        expect(ids(result.current.messages)).toEqual([message(1).messageId]);
        expect(arrived).toEqual(["Train at nine?"]);
      });

      // A stored send leaves the queue. Were it still there, the later failure
      // would give its text back too, and Send would store it a second time
      // (PR 444 review).
      it("give back only the second when the first was stored", async () => {
        const stored = { ...message(2, "u-me"), body: "Train at nine?" };
        const { arrived, answer } = twoSends();
        const { result } = renderHook(() => useTripChat({ tripId: TRIP, enabled: true, chatRev: "1", reading: false, accessLost: false }));
        await waitFor(() => expect(result.current.status).toBe("ready"));

        let first = Promise.resolve<string | null>("not answered");
        let second = Promise.resolve<string | null>(null);
        act(() => {
          first = result.current.post("Train at nine?");
          second = result.current.post("or ten?");
        });
        await waitFor(() => expect(arrived).toHaveLength(1));
        await act(async () => {
          answer(0, HttpResponse.json({ message: stored }, { status: 201 }));
          expect(await first).toBeNull();
        });
        await waitFor(() => expect(arrived).toHaveLength(2));
        await act(async () => {
          answer(1, HttpResponse.error());
          expect(await second).toBe("or ten?");
        });
        expect(ids(result.current.messages)).toEqual([message(1).messageId, stored.messageId]);
      });
    });
  });

  // PR 440 review, finding 3: a failed delete's alert sat above the composer
  // until the next edit or delete, however much happened after it.
  it("drops a failed change's error once the conversation is read again, or the reader posts", async () => {
    const id = message(1).messageId;
    server.use(
      http.get(`/api/trips/${TRIP}/chat`, () => HttpResponse.json(pageOf([message(1)]))),
      http.delete(`/api/trips/${TRIP}/chat/${id}`, () => HttpResponse.error()),
      http.post(`/api/trips/${TRIP}/chat`, () => HttpResponse.json({ message: message(2) }, { status: 201 })),
    );
    const { result, rerender } = renderHook((chatRev: string) => useTripChat({ tripId: TRIP, enabled: true, chatRev, reading: false, accessLost: false }), {
      initialProps: "1",
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    await act(async () => expect(await result.current.remove(id)).toBe(false));
    expect(result.current.changeError).not.toBeNull();
    rerender("2");
    await waitFor(() => expect(result.current.changeError).toBeNull());

    await act(async () => expect(await result.current.remove(id)).toBe(false));
    expect(result.current.changeError).not.toBeNull();
    await act(async () => expect(await result.current.post("Back online")).toBeNull());
    expect(result.current.changeError).toBeNull();
  });
});
