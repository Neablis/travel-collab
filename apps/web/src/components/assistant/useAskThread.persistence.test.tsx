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
import { loadAskThread, saveAskThread } from "@/components/assistant/askThreadStore";
import type { AssistantTurn } from "./Transcript";
import type { ProposalStatus } from "./ProposalCard";
import { registerPaletteCommands } from "@/components/palette/paletteRegistry";

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
  //
  // **It has to have a turn to be unaffected about** (CodeRabbit, PR #188).
  // This asserted an empty thread on an empty mount, and `saveAskThread`
  // returns before touching `setItem` when the thread is empty — so the
  // throwing stub below was never called and the test passed without ever
  // exercising a refused write. It runs a real ask now.
  it("still works when the browser refuses storage", async () => {
    vi.stubGlobal("fetch", answeringFetch("Still available."));
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
    await act(async () => {
      await result.current.runAsk("Does this still work?");
    });
    expect(result.current.thread.map((turn) => turn.text)).toEqual([
      "Does this still work?",
      "Still available.",
    ]);
    expect(() => act(() => result.current.startNewConversation())).not.toThrow();
  });
});

// ADR-067: a planning turn can store suggestions, and the board re-reads them
// when the turn ends — however it ends, since a stopped or failed turn may
// have stored them before the announcement was lost.
describe("useAskThread — onTurnEnd", () => {
  function mountWith(onTurnEnd: () => void) {
    return renderHook(() =>
      useAskThread({ tripId: TRIP, scope: { kind: "trip" }, errorMessage: (error: ApiError) => error.message, onTurnEnd }),
    );
  }

  it("is called once when a turn is answered", async () => {
    vi.stubGlobal("fetch", answeringFetch("Done."));
    const onTurnEnd = vi.fn();
    const { result } = mountWith(onTurnEnd);
    await act(() => result.current.runAsk("add a day in Kyoto"));
    expect(onTurnEnd).toHaveBeenCalledTimes(1);
  });

  it("is called when a turn fails, and when one is cancelled", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "boom" }), { status: 500 })));
    const onTurnEnd = vi.fn();
    const { result } = mountWith(onTurnEnd);
    await act(() => result.current.runAsk("add a day"));
    expect(onTurnEnd).toHaveBeenCalledTimes(1);

    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) =>
            init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))),
          ),
      ),
    );
    let asked: Promise<void> = Promise.resolve();
    act(() => {
      asked = result.current.runAsk("add another day");
    });
    act(() => result.current.cancel());
    await act(() => asked);
    await waitFor(() => expect(onTurnEnd).toHaveBeenCalledTimes(2));
  });
});

// ADR-072: a reply's palette commands reach the page's runner from here, so no
// surface has to wire them. Navigation runs on arrival; a change waits on a card.
describe("useAskThread — where a reply takes you", () => {
  const DAY = "22222222-2222-4222-8222-222222222222";
  const taken: Array<() => void> = [];
  afterEach(() => taken.splice(0).forEach((takeBack) => takeBack()));

  const NOTEBOOK = "33333333-3333-4333-8333-333333333333";
  const PROPOSAL = {
    proposalId: "p1",
    changes: [{ type: "AddActivity", text: "Add “Coffee” to day 2" }],
    commands: [{ type: "AddActivity", tripId: TRIP, activityId: DAY, dayId: DAY, title: "Coffee" }],
    inserts: [],
    skipped: [],
  };

  function replying(paletteCommands: unknown[], outcome: Record<string, unknown> = {}) {
    const frames = [
      { type: "text-delta", delta: "Taking you there." },
      { type: "finish", finishReason: "stop", messageMetadata: { ...outcome, ...(paletteCommands.length > 0 && { paletteCommands }) } },
    ];
    return vi.fn(
      async () =>
        new Response(`${frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("")}data: [DONE]\n\n`, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }),
    );
  }

  // The board's own handler: a proposal is attached to its answer, pending.
  function mountBoard(holdsLeaving?: () => string | null) {
    return renderHook(() =>
      useAskThread({
        tripId: TRIP,
        scope: { kind: "trip" },
        errorMessage: (error: ApiError) => error.message,
        ...(holdsLeaving !== undefined && { holdsLeaving }),
        onEvent: (event, patchAnswer) => {
          if (event.type === "proposal") patchAnswer((turn) => ({ ...turn, proposal: { proposal: event.proposal, status: "pending", note: null } }));
        },
      }),
    );
  }

  function offerNotebookAndMap() {
    const setView = vi.fn();
    const openNotebook = vi.fn();
    taken.push(
      registerPaletteCommands("test", [
        { id: "view:Map", action: "Go to", type: "View", target: { label: "Map" }, run: setView },
        { id: `go:notebook:${NOTEBOOK}`, action: "Go to", type: "Notebook", target: { label: "Bookings" }, run: openNotebook },
      ]),
    );
    return { setView, openNotebook };
  }

  it("runs the page's command, says what it could not do, and holds a change for Approve", async () => {
    const setView = vi.fn();
    const toggle = vi.fn();
    taken.push(
      registerPaletteCommands("test", [
        { id: "view:Map", action: "Go to", type: "View", target: { label: "Map" }, run: setView },
        { id: "notebook-editing", action: "Edit", type: "Notebook", target: { label: "Turn editing on" }, run: toggle },
      ]),
    );
    vi.stubGlobal(
      "fetch",
      replying([
        { id: "view:Map", needsApproval: false },
        { id: `go:day:${DAY}`, needsApproval: false },
        { id: "notebook-editing", needsApproval: true, on: true },
      ]),
    );
    const { result } = mountBoard();
    await act(() => result.current.runAsk("show day 2 on the map and turn on editing"));

    expect(setView).toHaveBeenCalledTimes(1);
    expect(toggle).not.toHaveBeenCalled();
    const answer = result.current.thread.at(-1) as Extract<AssistantTurn, { role: "assistant" }>;
    expect(answer.text).toBe("Taking you there.\n\nI couldn't go to that day from this page.");
    // The direction travels with the offer: without `on` the card cannot tell
    // the page is already there, and Approve would turn editing off.
    expect(answer.offers).toEqual([{ id: "notebook-editing", key: expect.any(String), on: true }]);
  });

  // ADR-072 §4: a proposal is not kept across leaving the board
  // (`askThreadStore` drops it), so a reply that both proposes and opens a
  // notebook would lose the card before anyone could approve it. Moving on
  // the board still runs; leaving it waits, and the reply says why.
  it("leaves the board for nothing while this turn's change waits for Approve, and says so", async () => {
    const { setView, openNotebook } = offerNotebookAndMap();
    vi.stubGlobal(
      "fetch",
      replying(
        [
          { id: "view:Map", needsApproval: false },
          { id: `go:notebook:${NOTEBOOK}`, needsApproval: false },
        ],
        { proposal: PROPOSAL },
      ),
    );
    const { result } = mountBoard();
    await act(() => result.current.runAsk("add coffee on day 2 and open my bookings notebook"));

    expect(setView).toHaveBeenCalledTimes(1);
    expect(openNotebook).not.toHaveBeenCalled();
    expect(result.current.thread.at(-1)?.text).toContain(
      "I didn't open that notebook, because the change above is waiting for you to approve or turn it down.",
    );
  });

  // A card mid-apply, or one whose apply failed, still has an Approve to press.
  it.each<ProposalStatus>(["pending", "applying", "failed"])("holds while an earlier turn's change is %s, and goes once it is decided", async (status) => {
    const { openNotebook } = offerNotebookAndMap();
    const { result } = mountBoard();
    vi.stubGlobal("fetch", replying([], { proposal: PROPOSAL }));
    await act(() => result.current.runAsk("add coffee on day 2"));
    const card = result.current.thread.find((turn) => turn.role === "assistant" && turn.proposal != null)!;
    act(() =>
      result.current.patchTurn(card.id, (turn) =>
        turn.role === "assistant" && turn.proposal != null ? { ...turn, proposal: { ...turn.proposal, status } } : turn,
      ),
    );

    vi.stubGlobal("fetch", replying([{ id: `go:notebook:${NOTEBOOK}`, needsApproval: false }]));
    await act(() => result.current.runAsk("open my bookings notebook"));
    expect(openNotebook).not.toHaveBeenCalled();

    const proposed = result.current.thread.find((turn) => turn.role === "assistant" && turn.proposal != null)!;
    act(() =>
      result.current.patchTurn(proposed.id, (turn) =>
        turn.role === "assistant" && turn.proposal != null ? { ...turn, proposal: { ...turn.proposal, status: "rejected" } } : turn,
      ),
    );
    await act(() => result.current.runAsk("open my bookings notebook"));
    expect(openNotebook).toHaveBeenCalledTimes(1);
  });

  // ADR-072 §4: an open stop editor is unmounted by leaving the board, and its
  // typed fields with it. The caller says so; moving on the board still runs.
  it("leaves the page for nothing while the caller holds it, says why, and still moves on it", async () => {
    const { setView, openNotebook } = offerNotebookAndMap();
    const { result } = mountBoard(() => "you have a stop open for editing");
    vi.stubGlobal(
      "fetch",
      replying([
        { id: "view:Map", needsApproval: false },
        { id: `go:notebook:${NOTEBOOK}`, needsApproval: false },
      ]),
    );
    await act(() => result.current.runAsk("show the map and open my bookings notebook"));

    expect(setView).toHaveBeenCalledTimes(1);
    expect(openNotebook).not.toHaveBeenCalled();
    expect(result.current.thread.at(-1)?.text).toContain("I didn't open that notebook, because you have a stop open for editing.");
  });
});
