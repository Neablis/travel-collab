// **The conversation survives a reload** — M9's third remainder, at the hook.
//
// `askThreadStore.test.ts` covers what is written and what comes back.
// What only this file can cover is what the HOOK owns: that a stored
// conversation comes back on the next mount, that the ids it restores do not
// collide with the ones this session is about to mint, and that a new
// conversation forgets rather than merely empties.
//
// **This header used to claim a third invariant — "a restored thread must not
// overwrite a live one" — and that claim was stale** (CodeRabbit, PR #184).
// The restore effect replaces UNCONDITIONALLY, deliberately: `persistAs` IS the
// conversation's identity, so a surface that switches conversations should get
// the new one rather than keep the old, and making that one rule instead of two
// is why the guard went. An invariant stated in a comment with no test
// enforcing it is a documented recurring defect class in this repo (KI-1,
// KI-14) — so it is corrected here rather than left to read as coverage.
//
// A reload is simulated by unmounting and mounting again under the same name,
// which is what a reload is to a component.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ApiError } from "@/lib/apiClient";
import { useAskThread } from "./useAskThread";
import { loadAskThread, saveAskThread } from "@/lib/askThreadStore";
import type { AssistantTurn } from "./Transcript";

const TRIP = "11111111-2222-4333-8444-555566667777";
const NAME = `trip:${TRIP}`;

function mount(persistAs: string | undefined) {
  return renderHook(() =>
    useAskThread({
      tripId: TRIP,
      scope: { kind: "trip" },
      errorMessage: (error: ApiError) => error.message,
      ...(persistAs === undefined ? {} : { persistAs }),
    }),
  );
}

/** A fetch that answers the ask endpoint with one SSE text delta. */
function answeringFetch(text: string) {
  return vi.fn(
    async () =>
      new Response(`data: ${JSON.stringify({ type: "text-delta", delta: text })}\n\ndata: [DONE]\n\n`, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
  );
}

const stored: AssistantTurn[] = [
  { id: "u1", role: "user", text: "how does this trip look?" },
  { id: "a2", role: "assistant", text: "Kyoto 2027 runs to 3 days.", tools: [], pending: false },
];

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("useAskThread — durability", () => {
  it("brings the conversation back on the next mount", async () => {
    saveAskThread(NAME, stored);
    const { result } = mount(NAME);
    await waitFor(() => expect(result.current.thread).toHaveLength(2));
    expect(result.current.thread.map((turn) => turn.text)).toEqual([
      "how does this trip look?",
      "Kyoto 2027 runs to 3 days.",
    ]);
  });

  // **Opt-in.** A surface that has not thought about what a restored transcript
  // means on it gets the behaviour it has today, and the stored thread of
  // another surface is not its business either.
  it("restores nothing when the caller did not name a conversation", async () => {
    saveAskThread(NAME, stored);
    const { result } = mount(undefined);
    // A restore would land in an effect, so let effects flush before deciding
    // that none did. `waitFor` polls, which is what makes the negative real
    // rather than a snapshot taken too early.
    await waitFor(() => expect(result.current.asking).toBe(false));
    expect(result.current.thread).toEqual([]);
  });

  // **The ids have to stay unique against the ones this session mints.**
  // `nextTurnId` counts from zero, so a restored `u1` and a new `u1` would
  // collide — and `patchAnswer` patches BY ID, so the new answer's deltas would
  // land on the restored turn.
  it("mints ids past anything it restored", async () => {
    saveAskThread(NAME, stored);
    const { result } = mount(NAME);
    await waitFor(() => expect(result.current.thread).toHaveLength(2));

    // A turn that fails immediately still mints both ids before it posts.
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    await act(async () => {
      await result.current.runAsk("and the free time?");
    });

    const ids = result.current.thread.map((turn) => turn.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("u1");
    expect(ids).not.toContain("u3");
  });

  // "New conversation" forgets rather than just empties, so a user who asks for
  // one and then closes the tab does not come back to the old thread.
  // `clearAskThread` is the only thing that forgets — the save effect never
  // removes, deliberately (see the hook's own note).
  // **Switching trips used to move one trip's conversation onto another**
  // (CodeRabbit, PR #188). Effects run in declaration order, so on the render
  // where `persistAs` changes the restore has only SCHEDULED its `setThread`
  // and the save still sees the OLD thread — which it then wrote under the NEW
  // name. `saveAskThread` returns early on an empty thread rather than
  // removing, so the empty restore that followed could not undo it: opening
  // the second trip showed the first trip's conversation, and it persisted.
  it("does not carry one trip's conversation into another when the surface re-keys", async () => {
    const OTHER = "trip:99999999-2222-4333-8444-555566667777";
    saveAskThread(NAME, stored);

    const view = renderHook(
      ({ name }: { name: string }) =>
        useAskThread({
          tripId: TRIP,
          scope: { kind: "trip" },
          errorMessage: (error: ApiError) => error.message,
          persistAs: name,
        }),
      { initialProps: { name: NAME } },
    );
    await waitFor(() => expect(view.result.current.thread).toHaveLength(2));

    view.rerender({ name: OTHER });
    await waitFor(() => expect(view.result.current.thread).toHaveLength(0));

    // The trip with no conversation still has none — in storage, not just on
    // screen, which is the half that outlived the switch.
    expect(loadAskThread(OTHER)).toEqual([]);
    // And the trip that owns it kept it.
    expect(loadAskThread(NAME)).toHaveLength(2);
  });

  // **An error belongs to the conversation that produced it** (CodeRabbit, PR
  // #188). Re-keying aborted the request but left everything the request had
  // already put on screen: switching trips carried the previous trip's error
  // banner into a conversation that never failed — and a `status` still reading
  // "loading" would have left the composer disabled for a cancelled request.
  it("does not carry one trip's error into the next conversation", async () => {
    const OTHER = "trip:99999999-2222-4333-8444-555566667777";
    // A real 500, spelled out here because this file has no `jsonResponse`
    // helper — and a mock that merely THROWS would set an error too, which
    // would make this test pass for a reason it does not name.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "the assistant is unavailable" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );

    const view = renderHook(
      ({ name }: { name: string }) =>
        useAskThread({
          tripId: TRIP,
          scope: { kind: "trip" },
          errorMessage: (error: ApiError) => error.message,
          persistAs: name,
        }),
      { initialProps: { name: NAME } },
    );

    await act(async () => {
      await view.result.current.runAsk("how does this trip look?");
    });
    expect(view.result.current.askError).not.toBeNull();

    view.rerender({ name: OTHER });
    await waitFor(() => expect(view.result.current.askError).toBeNull());
    expect(view.result.current.asking).toBe(false);
  });

  it("forgets the stored conversation when a new one is started", async () => {
    saveAskThread(NAME, stored);
    const first = mount(NAME);
    await waitFor(() => expect(first.result.current.thread).toHaveLength(2));
    act(() => first.result.current.startNewConversation());
    await waitFor(() => expect(first.result.current.thread).toHaveLength(0));
    // Asserted on STORAGE rather than on the next mount: the thread being empty
    // on screen is what `startNewConversation` obviously does, and what this
    // test is about is whether the stored copy went with it.
    expect(window.localStorage.getItem(`ask_thread_v1:${NAME}`)).toBeNull();
  });

  // **The whole point, end to end: ask, reload, still there** — and it goes
  // through the hook's OWN save rather than through the store, which is the
  // only way this asserts the thing the gate box is about.
  it("persists a turn this session produced, and restores it on the next mount", async () => {
    vi.stubGlobal("fetch", answeringFetch("Kyoto 2027 runs to 3 days."));
    const first = mount(NAME);
    await act(async () => {
      await first.result.current.runAsk("how does this trip look?");
    });
    expect(first.result.current.thread.map((turn) => turn.text)).toEqual([
      "how does this trip look?",
      "Kyoto 2027 runs to 3 days.",
    ]);
    cleanup();

    const second = mount(NAME);
    await waitFor(() => expect(second.result.current.thread).toHaveLength(2));
    expect(second.result.current.thread.map((turn) => turn.text)).toEqual([
      "how does this trip look?",
      "Kyoto 2027 runs to 3 days.",
    ]);
  });

  // A turn that produced no text at all is rolled back by design — the
  // question goes back in the composer — so there is nothing to persist. Pinned
  // rather than worked around: a stored orphan question is worse than none.
  it("stores nothing for a turn that failed before it said anything", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    const { result } = mount(NAME);
    await act(async () => {
      await result.current.runAsk("a question that fails");
    });
    expect(result.current.thread).toEqual([]);
    expect(window.localStorage.getItem(`ask_thread_v1:${NAME}`)).toBeNull();
  });

  // **The save effect must not run before the restore effect has read.**
  //
  // Effects run in declaration order after a commit, so on first mount the
  // restore SCHEDULES its state update and the save then runs against the
  // render's thread, which is still empty — and an empty thread is stored as a
  // REMOVAL. Without the latch, mounting the board deleted the stored
  // conversation and rewrote it a paint later, and a tab closed inside that
  // window lost the thread it was about to show.
  it("never removes the stored conversation on the way to restoring it", async () => {
    saveAskThread(NAME, stored);
    const real = window.localStorage;
    const removals: string[] = [];
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => real.getItem(key),
      setItem: (key: string, value: string) => real.setItem(key, value),
      removeItem: (key: string) => {
        removals.push(key);
        real.removeItem(key);
      },
      clear: () => real.clear(),
    });

    const { result } = mount(NAME);
    await waitFor(() => expect(result.current.thread).toHaveLength(2));
    expect(removals).toEqual([]);
  });

  // **A streamed answer is stored as the settled turn it becomes**, not as one
  // that is still streaming. `storable` forces `pending: false` on the way in,
  // which is the same treatment `runAsk` gives a turn that failed part way
  // through: the words are real, the streaming is over.
  //
  // (There is deliberately no assertion here about HOW MANY times the effect
  // writes during a stream. `act` batches, so this lane cannot tell one write
  // from four — see the hook's own note on why the guard that would have needed
  // such an assertion was deleted rather than left unfalsifiable.)
  it("stores a streamed answer as a settled turn", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              async start(controller) {
                const encoder = new TextEncoder();
                for (const i of [0, 1, 2, 3]) {
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({ type: "text-delta", delta: `part ${i} ` })}\n\n`),
                  );
                  await new Promise((resolve) => setTimeout(resolve, 0));
                }
                controller.close();
              },
            }),
            { status: 200, headers: { "Content-Type": "text/event-stream" } },
          ),
      ),
    );

    const { result } = mount(NAME);
    await waitFor(() => expect(result.current.asking).toBe(false));
    await act(async () => {
      await result.current.runAsk("how does this trip look?");
    });
    cleanup();

    const second = mount(NAME);
    await waitFor(() => expect(second.result.current.thread).toHaveLength(2));
    // The text, which is the round trip. That a turn stored WHILE pending comes
    // back settled is `askThreadStore.test.ts`'s — by the time `runAsk`
    // resolves this one is already settled, so asserting it here would assert
    // nothing.
    expect(second.result.current.thread[1]!.text).toBe("part 0 part 1 part 2 part 3 ");
  });

  // The conversation on screen is unaffected by a browser that refuses
  // storage; only its durability is.
  it("still works when the browser refuses storage", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
    });
    const { result } = mount(NAME);
    await waitFor(() => expect(result.current.asking).toBe(false));
    expect(result.current.thread).toEqual([]);
    expect(() => act(() => result.current.startNewConversation())).not.toThrow();
  });
});
