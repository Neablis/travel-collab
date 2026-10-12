// The assistant's conversation, across a reload — M9's third remainder.
//
// Two things are being tested and they pull in opposite directions: that a
// thread comes back, and that **what comes back is a transcript rather than a
// live turn**. The second is the one with teeth — a restored `pending` answer
// streams forever, and a restored proposal puts an Approve button over a plan
// built against a trip that has since moved.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantTurn } from "@/components/assistant/Transcript";
import { forgetAskConversationsOf, ownedAskName } from "@/lib/askOwnership";
import { clearAskDraft, clearAskThread, loadAskDraft, loadAskThread, saveAskDraft, saveAskThread } from "./askThreadStore";

// Owned, as every caller stores it: an unowned name is a legacy key, swept.
const NAME = ownedAskName("user-a", "trip:11111111-2222-4333-8444-555566667777");

const user = (id: string, text: string): AssistantTurn => ({ id, role: "user", text });
const answer = (id: string, text: string, extra: Partial<Extract<AssistantTurn, { role: "assistant" }>> = {}) =>
  ({ id, role: "assistant", text, tools: [], pending: false, ...extra }) as AssistantTurn;

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  // Unstubbed FIRST: the refusal test replaces `localStorage` with an object
  // that has no `clear`, and clearing before restoring throws in teardown —
  // which reports as a failure of every test in the file rather than of the
  // one that stubbed.
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("the ask thread store", () => {
  it("brings a conversation back, in order", () => {
    const thread = [user("u1", "how does this look?"), answer("a2", "Kyoto 2027 runs to 3 days.")];
    saveAskThread(NAME, thread);
    expect(loadAskThread(NAME)).toEqual(thread);
  });

  it("keeps conversations on different surfaces apart", () => {
    saveAskThread(NAME, [user("u1", "board")]);
    saveAskThread("page:abc", [user("u1", "notebook")]);
    expect(loadAskThread(NAME)[0]!.text).toBe("board");
    expect(loadAskThread("page:abc")[0]!.text).toBe("notebook");
  });

  it("has no conversation before there is one", () => {
    expect(loadAskThread(NAME)).toEqual([]);
  });

  // **A turn stored mid-stream must not rehydrate as one that streams
  // forever.** `cancel()` settles a pending answer for exactly this reason; a
  // reload is the one abandonment it cannot catch.
  it("never restores a turn as still pending", () => {
    saveAskThread(NAME, [answer("a1", "half an ans", { pending: true })]);
    const [restored] = loadAskThread(NAME);
    expect((restored as Extract<AssistantTurn, { role: "assistant" }>).pending).toBe(false);
    expect(restored!.text).toBe("half an ans");
  });

  // **A proposal is a live offer, not a transcript.** Restoring one a day later
  // would put an Approve button over a plan built against a trip that has since
  // moved. The apply door would still be safe — it re-reads the trip inside its
  // own transaction — but "safe" is not the bar for a button that says it will
  // change your trip.
  it("drops the proposal and keeps the prose that explained it", () => {
    saveAskThread(NAME, [
      answer("a1", "I'd add a coffee stop to day 1.", {
        proposal: { proposal: { proposalId: "p1", changes: [], commands: [], inserts: [], skipped: [] }, status: "pending", note: null },
      }),
    ]);
    const [restored] = loadAskThread(NAME) as Extract<AssistantTurn, { role: "assistant" }>[];
    expect(restored!.text).toBe("I'd add a coffee stop to day 1.");
    expect("proposal" in restored!).toBe(false);
  });

  it("forgets a conversation on request", () => {
    saveAskThread(NAME, [user("u1", "hello")]);
    clearAskThread(NAME);
    expect(loadAskThread(NAME)).toEqual([]);
    expect(window.localStorage.getItem("ask_thread_v1:" + NAME)).toBeNull();
  });

  // **An empty thread writes nothing and REMOVES NOTHING**, and that asymmetry
  // is a correctness guard rather than tidiness. Restoring happens in an
  // effect, so there is one commit where the component has a stored
  // conversation and an empty `thread` — a save that treated empty as "forget
  // this" would delete the conversation on the way to showing it. Forgetting is
  // `clearAskThread`, which is a thing a caller DOES.
  it("leaves a stored conversation alone when asked to save an empty one", () => {
    saveAskThread(NAME, [user("u1", "hello")]);
    saveAskThread(NAME, []);
    expect(loadAskThread(NAME).map((turn) => turn.text)).toEqual(["hello"]);
  });

  // The oldest turns go first, because a conversation is read from the bottom.
  it("keeps the most recent turns when a thread outgrows the ceiling", () => {
    const long = Array.from({ length: 60 }, (_, i) => user(`u${i}`, `turn ${i}`));
    saveAskThread(NAME, long);
    const restored = loadAskThread(NAME);
    expect(restored).toHaveLength(40);
    expect(restored[restored.length - 1]!.text).toBe("turn 59");
    expect(restored[0]!.text).toBe("turn 20");
  });

  // `localStorage` throws `QuotaExceededError` when the ORIGIN is full, and the
  // throw lands on whichever write is last — so one enormous thread takes down
  // the next unrelated write rather than its own.
  it("trims a pathologically large thread by characters, not just by count", () => {
    const huge = Array.from({ length: 5 }, (_, i) => user(`u${i}`, "x".repeat(60_000)));
    saveAskThread(NAME, huge);
    const stored = window.localStorage.getItem("ask_thread_v1:" + NAME)!;
    expect(stored.length).toBeLessThanOrEqual(200_000);
    // ...and what survives is the end of the conversation.
    expect(loadAskThread(NAME).length).toBeGreaterThan(0);
    expect(loadAskThread(NAME).at(-1)!.id).toBe("u4");
  });

  // **One turn can be over the ceiling on its own**, and the trimming loop
  // stops at one turn — so without an explicit guard it wrote a value past the
  // limit it documents (CodeRabbit, PR #184). The write is skipped rather than
  // the turn truncated: half a message read back is a quieter lie than none.
  it("writes nothing when a single turn is bigger than the ceiling", () => {
    saveAskThread(NAME, [user("u1", "x".repeat(250_000))]);
    expect(window.localStorage.getItem("ask_thread_v1:" + NAME)).toBeNull();
  });

  it("never stores a value over the ceiling, whatever it is handed", () => {
    for (const thread of [
      [user("u1", "x".repeat(250_000))],
      [user("u1", "small"), user("u2", "x".repeat(250_000))],
      Array.from({ length: 5 }, (_, i) => user(`u${i}`, "x".repeat(60_000))),
    ]) {
      window.localStorage.clear();
      saveAskThread(NAME, thread);
      const stored = window.localStorage.getItem("ask_thread_v1:" + NAME);
      if (stored !== null) expect(stored.length).toBeLessThanOrEqual(200_000);
    }
  });

  // **Safari's private mode throws on `localStorage`**, and Node 26 leaves
  // `window.localStorage` undefined in the jsdom lane (KI-2026-09-02-a). The
  // conversation on screen must be unaffected; only its durability is.
  it("degrades to no conversation when the browser refuses storage", () => {
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
    expect(() => saveAskThread(NAME, [user("u1", "hello")])).not.toThrow();
    expect(loadAskThread(NAME)).toEqual([]);
    expect(() => clearAskThread(NAME)).not.toThrow();
  });

  // A value written by an older build is the realistic hostile input here —
  // nothing else can be in the user's own storage. `Transcript` maps over
  // `tools` with no guard of its own, so a shape that is not a turn is a render
  // crash on the surface the user was trying to get back to.
  it.each([
    ["not JSON at all", "{{{"],
    ["not an array", '{"thread":[]}'],
  ])("reads %s as no conversation", (_label, raw) => {
    window.localStorage.setItem("ask_thread_v1:" + NAME, raw);
    expect(loadAskThread(NAME)).toEqual([]);
  });

  it("drops individual turns it cannot render, and keeps the rest", () => {
    window.localStorage.setItem(
      "ask_thread_v1:" + NAME,
      JSON.stringify([
        { id: "u1", role: "user", text: "kept" },
        { id: "a2", role: "assistant", text: "no tools array" },
        { id: "a3", role: "assistant", text: "bad note", tools: [{ id: 1 }] },
        { role: "user", text: "no id" },
        { id: "a5", role: "assistant", text: "kept too", tools: [{ id: "t1", label: "Read the trip" }] },
      ]),
    );
    expect(loadAskThread(NAME).map((turn) => turn.text)).toEqual(["kept", "kept too"]);
  });

  // **Versioned, because `SPEC.md` §28 is a recorded incident**: the old
  // `theme` key still held a stale stored value. A thread written under a
  // previous shape must not be read as a current one.
  it("ignores a thread stored under a different version", () => {
    window.localStorage.setItem("ask_thread_v0:" + NAME, JSON.stringify([user("u1", "old")]));
    expect(loadAskThread(NAME)).toEqual([]);
  });
});

// KI-2026-10-12-g: the composer's unsent text, kept beside its conversation.
describe("the ask draft store", () => {
  it("keeps one draft per conversation, and an emptied box is no draft", () => {
    saveAskDraft(NAME, "and the second day?");
    saveAskDraft("account", "which city most?");
    expect(loadAskDraft(NAME)).toBe("and the second day?");
    expect(loadAskDraft("account")).toBe("which city most?");
    saveAskDraft(NAME, "   ");
    expect(loadAskDraft(NAME)).toBeNull();
    clearAskDraft("account");
    expect(loadAskDraft("account")).toBeNull();
  });

  it("degrades to no draft when the browser refuses storage", () => {
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
    expect(() => saveAskDraft(NAME, "hello")).not.toThrow();
    expect(loadAskDraft(NAME)).toBeNull();
    expect(() => clearAskDraft(NAME)).not.toThrow();
  });
});

// PR 426 review, finding 1: sign-out forgets one account's conversations on a
// shared browser, and no one else's, including an id this one is a prefix of.
describe("forgetting one account's conversations", () => {
  it("removes that account's threads and drafts and keeps every other account's", () => {
    const turn: AssistantTurn = { id: "u1", role: "user", text: "what did I spend?" };
    saveAskThread(ownedAskName("user-a", "account"), [turn]);
    saveAskDraft(ownedAskName("user-a", NAME), "and dinner?");
    saveAskThread(ownedAskName("user-ab", "account"), [turn]);
    saveAskDraft(ownedAskName("user-b", NAME), "where next?");

    forgetAskConversationsOf("user-a");

    expect(loadAskThread(ownedAskName("user-a", "account"))).toEqual([]);
    expect(loadAskDraft(ownedAskName("user-a", NAME))).toBeNull();
    expect(loadAskThread(ownedAskName("user-ab", "account"))).toEqual([turn]);
    expect(loadAskDraft(ownedAskName("user-b", NAME))).toBe("where next?");
  });
});

// PR 426's round 1 put an owner in every name. Keys stored before it have
// none, and can hold the conversation of whoever used this browser before.
describe("the keys stored before conversations had owners", () => {
  it("are removed on the store's first use, and owned keys are kept", async () => {
    window.localStorage.setItem("ask_thread_v1:trip:11111111-2222-4333-8444-555566667777", "[]");
    window.localStorage.setItem("ask_thread_v1:account", "[]");
    window.localStorage.setItem("ask_draft_v1:notebook:t1", "and dinner?");
    window.localStorage.setItem("ask_draft_v1:page:p1", "a packing list");
    window.localStorage.setItem(`ask_draft_v1:${NAME}`, "where next?");
    window.localStorage.setItem("ask_thread_v1:user-a:account", "[]");
    window.localStorage.setItem("theme", "dark");

    // A fresh module is a fresh page load.
    vi.resetModules();
    const store = await import("./askThreadStore");
    expect(store.loadAskDraft(NAME)).toBe("where next?");

    expect(Object.keys(window.localStorage).sort()).toEqual([`ask_draft_v1:${NAME}`, "ask_thread_v1:user-a:account", "theme"].sort());
  });

  it("still lets the store work when the browser refuses storage", async () => {
    vi.stubGlobal("localStorage", {
      get length(): number {
        throw new Error("SecurityError");
      },
      getItem: () => {
        throw new Error("SecurityError");
      },
    });
    vi.resetModules();
    const store = await import("./askThreadStore");
    expect(store.loadAskDraft(NAME)).toBeNull();
    expect(store.loadAskThread(NAME)).toEqual([]);
  });
});
