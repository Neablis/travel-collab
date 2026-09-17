"use client";
import { useEffect, useRef, useState } from "react";
import {
  ASK_ABORTED_CODE,
  askAssistant,
  type ApiError,
  type AskEvent,
  type AskScope,
  type AskWireMessage,
} from "@/lib/apiClient";
import { MAX_ASK_MESSAGES } from "@/lib/askLimits";
import { clearAskThread, loadAskThread, saveAskThread } from "@/lib/askThreadStore";

import { toolNoteLabel, type AssistantTurn } from "./Transcript";

// One conversation with the assistant, and everything a rail needs to render
// it: the thread, whether a turn is in flight, the error, the simulated badge,
// how many questions are left, and the draft to put back after a rollback.
//
// **It was `TripBoardScreen`'s, and it is here because M14 link 8's second half
// gives the Notebook the same rail.** The board's copy was ~150 lines of
// conversation machinery threaded through a component that is otherwise about a
// plan; a page needed all of it and none of the board. Copying it would have
// meant two thread ceilings, two rollback rules and two definitions of "this
// turn was abandoned" — and the abandonment rule in particular is the kind that
// is subtly wrong in the second copy.
//
// **What stayed behind is what is genuinely the caller's**: which scope a turn
// is about, the refusals that happen BEFORE a turn is posted (the board refuses
// a viewer and refuses while unsent edits are queued), and what to do with an
// event only that surface can act on — a `proposal` for the board, a
// `page-inserts` for a page. Those arrive through `onEvent` below.

/**
 * A caller's hook into the stream, for the events only it can act on.
 *
 * `patchAnswer` edits THIS turn's answer and no other, by id — a stale stream
 * that outlived its turn cannot write into a newer one. It is handed over
 * rather than exposed on the returned object for exactly that reason: outside
 * the turn there is no correct answer to patch.
 */
export type AskEventHandler = (
  event: AskEvent,
  patchAnswer: (fn: (turn: Extract<AssistantTurn, { role: "assistant" }>) => AssistantTurn) => void,
) => void;

export interface AskThread {
  thread: AssistantTurn[];
  asking: boolean;
  askError: string | null;
  /**
   * The server's `code` for that refusal, when it had one.
   *
   * Carried beside the message rather than folded into it because two refusals
   * are not failures and one of them is actionable: M20's `ai-not-entitled`
   * wants an upgrade path, not a red alert, and a surface cannot tell which it
   * has from prose. `null` for a client-side refusal and for any error the
   * server did not code.
   */
  askErrorCode: string | null;
  simulated: boolean;
  asksRemaining: number;
  restoredDraft: string | null;
  /** Posts a turn. Deliberately not awaited by callers — see the board's own note. */
  runAsk: (text: string) => Promise<void>;
  startNewConversation: () => void;
  /** Aborts the turn in flight and keeps the thread. See the implementation. */
  cancel: () => void;
  /**
   * A refusal the CALLER decided, shown through the same surface as a server
   * error. The board uses it for its two pre-ask refusals; without it those
   * would need their own error channel beside this one, and the rail would
   * have to know which of two errors to render.
   */
  refuse: (message: string) => void;
  /** Edits one turn's proposal by id. Board-only; a page turn has no proposals. */
  patchTurn: (turnId: string, fn: (turn: AssistantTurn) => AssistantTurn) => void;
}

/**
 * The highest turn number in a restored thread.
 *
 * Ids are `u3`/`a4` — a prefix and the shared counter — so a restored
 * conversation ends at some number this session's counter has to start past.
 * Anything unparseable contributes 0, which is the safe direction: it can only
 * make the counter start lower, and the `Math.max` against the live counter is
 * what stops that mattering.
 */
function highestTurnSeq(thread: readonly AssistantTurn[]): number {
  return thread.reduce((highest, turn) => {
    const parsed = Number.parseInt(turn.id.slice(1), 10);
    return Number.isFinite(parsed) && parsed > highest ? parsed : highest;
  }, 0);
}

export function useAskThread({
  tripId,
  scope,
  onEvent,
  errorMessage,
  persistAs,
}: {
  tripId: string;
  scope: AskScope;
  onEvent?: AskEventHandler;
  /** How this surface words a transport failure. */
  errorMessage: (error: ApiError) => string;
  /**
   * **Where to keep this conversation across a reload** (M9 design §6), or
   * undefined to keep it only as long as the surface is mounted.
   *
   * Opt-in and NAMED BY THE CALLER, because "which conversation is this?" is a
   * question only the surface can answer. Three surfaces mount this hook and
   * two of them share a `tripId` — a key derived from the hook's own arguments
   * would make the board and a notebook page the same thread, which is exactly
   * the collision a caller-supplied name cannot have by accident.
   *
   * Opt-in rather than on-by-default so a surface that has not thought about
   * what a restored transcript means on it gets the behaviour it has today.
   */
  persistAs?: string;
}): AskThread {
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [askError, setAskError] = useState<string | null>(null);
  const [askErrorCode, setAskErrorCode] = useState<string | null>(null);
  // The conversation itself, oldest turn first.
  //
  // Client-held (Ruling R1): there is no conversations table and no migration,
  // so this IS the conversation and the whole of it is posted back on every
  // turn. It survives hiding the rail (the holder stays mounted) and dies with
  // the page, which is the honest lifetime for something the server keeps
  // nothing of.
  const [thread, setThread] = useState<AssistantTurn[]>([]);
  const [simulated, setSimulated] = useState(false);
  // The text of a turn that was rolled back, for the rail's composer. See the
  // rollback in `runAsk`.
  const [restoredDraft, setRestoredDraft] = useState<string | null>(null);
  // Turn ids only have to be unique within one thread and stable across
  // re-renders; a counter says so and stays deterministic under test, where
  // `crypto.randomUUID` would not.
  const turnSeq = useRef(0);
  // Held so "New conversation" — and unmounting — can hang up on a turn that
  // is still streaming. Without it the composer stays disabled behind an answer
  // nobody wants, and navigating away mid-answer leaves the read running and
  // its setState firing into a tree that is gone.
  const abort = useRef<AbortController | null>(null);
  /** The key `thread` is known to belong to; see the save effect below. */
  const savedKey = useRef<string | undefined>(undefined);
  // Runs on unmount only, so it must not be keyed on anything that changes.
  useEffect(() => () => abort.current?.abort(), []);

  // `onEvent` is called from inside a stream that outlives the render it
  // started in. A ref keeps the CURRENT handler without making `runAsk` depend
  // on a callback identity every caller would then have to memoise.
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const errorMessageRef = useRef(errorMessage);
  errorMessageRef.current = errorMessage;

  // **Rehydrated in an effect, not in `useState`'s initialiser.** The
  // initialiser runs during the server render too, where `window` does not
  // exist — and even guarded, it would make the first client render disagree
  // with the server's HTML, which is a hydration mismatch rather than a missing
  // thread. So the surface mounts empty and the conversation arrives one paint
  // later, which is invisible and correct.
  //
  // Keyed on `persistAs`: the name IS the conversation's identity, so a surface
  // that switches conversations replaces the thread rather than keeping the
  // old one. Replacing unconditionally — including with an empty thread — is
  // what makes that one rule instead of two.
  useEffect(() => {
    if (persistAs === undefined) return;
    // **A request in flight belongs to the conversation being left.** Its
    // deltas would otherwise keep arriving after the new one is loaded, and
    // `patchAnswer` patches BY ID — a restored `a3` under the new key is a
    // legitimate target for the old turn's `a3`. Clearing the ref is what
    // makes the identity guard in `runAsk` reject them; aborting stops the
    // work as well as the writes. (CodeRabbit, PR #188.)
    abort.current?.abort();
    abort.current = null;
    const stored = loadAskThread(persistAs);
    setThread(stored);
    // The stored ids have to stay unique against the ones this session mints.
    // `nextTurnId` counts from zero, so a restored `u3` and a new `u3` would
    // collide — and `patchAnswer` patches BY ID. Starting the counter past
    // anything restored is what keeps that impossible.
    turnSeq.current = Math.max(turnSeq.current, highestTurnSeq(stored));
  }, [persistAs]);

  const nextTurnId = (prefix: string) => {
    turnSeq.current += 1;
    return `${prefix}${turnSeq.current}`;
  };

  // **Written whenever the thread changes, including mid-stream.**
  //
  // A `status === "loading"` guard was written here first, to save once per
  // TURN rather than once per delta — and then deleted, because no test in this
  // lane can falsify it: `act` batches, so four deltas are one render and one
  // write either way. A claim a test cannot make is a comment with a timer on
  // it (CLAUDE.md rule 3), so what is left is the behaviour that can be
  // asserted. The cost it was guarding is a `JSON.stringify` of at most 40
  // turns; the thing it was giving up is a transcript that survives a reload
  // taken mid-answer, which `storable` settles on the way in exactly as
  // `runAsk` settles a partial failure.
  //
  // **It never REMOVES, and that is what makes the restore above safe.**
  // Effects run in declaration order after a commit, so on first mount the
  // restore schedules its state update and this one then runs against the
  // render's thread, which is still empty. A save that treated empty as "forget
  // this" would delete the stored conversation on the way to showing it — and a
  // tab closed inside that window would lose the thread it was about to show.
  // `saveAskThread` returns on an empty thread for exactly this reason; the
  // first spelling had the removal there and a latch here trying to outrun it,
  // which a mutation test would not let stand.
  useEffect(() => {
    if (persistAs === undefined) return;
    // **The transition render is skipped, and that is the whole fix**
    // (CodeRabbit, PR #188). Effects run in declaration order, so on the
    // render where `persistAs` goes A -> B the restore above has only
    // SCHEDULED its `setThread`: `thread` here is still A's. Writing it
    // stored A's conversation under B's name — and because `saveAskThread`
    // returns early on an empty thread rather than removing, the next save
    // could not undo it. Opening B then showed A's conversation.
    //
    // A ref rather than state: it has to be readable in the same commit the
    // key changed in, which is exactly what state cannot do.
    if (savedKey.current !== persistAs) {
      savedKey.current = persistAs;
      return;
    }
    saveAskThread(persistAs, thread);
  }, [persistAs, thread]);

  const runAsk = async (text: string) => {
    const userTurn: AssistantTurn = { id: nextTurnId("u"), role: "user", text };
    const answerId = nextTurnId("a");
    // `thread` from this render's closure is the thread the user is looking at:
    // only one turn can be in flight (the composer and the suggestion chips are
    // both disabled while asking), so there is no newer one.
    const posted: AskWireMessage[] = [
      ...thread
        // A turn that failed before it produced any text is dropped below, but
        // a partial one is kept — and an empty `parts` array is not a message
        // the server's validator will accept.
        .filter((turn) => turn.text.trim() !== "")
        .map((turn) => ({ id: turn.id, role: turn.role, parts: [{ type: "text" as const, text: turn.text }] })),
      { id: userTurn.id, role: "user" as const, parts: [{ type: "text" as const, text }] },
    ];
    setThread((current) => [
      ...current,
      userTurn,
      { id: answerId, role: "assistant", text: "", tools: [], pending: true },
    ]);
    setStatus("loading");
    setAskError(null);
    setAskErrorCode(null);
    setSimulated(false);
    // Cleared so a second rollback of the SAME text still re-fires the rail's
    // restore effect — the value has to change for the effect to see it.
    setRestoredDraft(null);

    const controller = new AbortController();
    abort.current = controller;

    // Only ever touches the one answer turn this call owns, by id.
    const patchAnswer = (fn: (turn: Extract<AssistantTurn, { role: "assistant" }>) => AssistantTurn) =>
      setThread((current) => current.map((t) => (t.id === answerId && t.role === "assistant" ? fn(t) : t)));

    // Accumulated here as well as in the turn, because the rollback below has
    // to know whether ANY text arrived, and `askAssistant` only returns the
    // text when it succeeds.
    let streamed = "";
    const result = await askAssistant(
      tripId,
      posted,
      scope,
      (event) => {
        // **An abandoned turn stops writing anywhere, including into its
        // caller.** The identity guard below covers the turn's own completion;
        // this is the same rule applied per FRAME, and it is what makes
        // `cancel()` mean something to a surface that acts on events.
        //
        // `askAssistant` stops calling this once the signal aborts, but a frame
        // it has already parsed can still arrive — and a stream abandoned by
        // "New conversation" would otherwise patch text into a thread the user
        // has cleared, and hand `page-inserts` to a page that hung up on it.
        // Cancellation could never close that window from the caller's side,
        // which is why the notebook ALSO guards its insert on whether the page
        // is still being edited: two different questions, both worth asking.
        if (abort.current !== controller) return;
        if (event.type === "text") {
          streamed += event.delta;
          patchAnswer((turn) => ({ ...turn, text: turn.text + event.delta }));
        } else if (event.type === "tool") {
          patchAnswer((turn) => ({
            ...turn,
            tools: [...turn.tools, { id: event.toolCallId, label: toolNoteLabel(event.toolName, event.input) }],
          }));
        } else if (event.type === "meta") {
          // Ruling B: read from the response header the server sets, not from a
          // phrase in the model's own answer. It arrives before the first
          // delta, so a turn that dies mid-stream is still badged correctly —
          // which the prose sniff could not do, because the sentence it matched
          // is the LAST one.
          setSimulated(event.simulated);
        }
        // Everything else belongs to whoever mounted this. The board attaches a
        // `proposal` to the answer; a page inserts `page-inserts` into its
        // document. Neither is something a conversation can decide.
        onEventRef.current?.(event, patchAnswer);
      },
      controller.signal,
    );
    // **Identity, not a bare clear.** `abort.current = null` unconditionally
    // meant a turn that had already been abandoned — by "New conversation", or
    // by `cancel` below — could resolve LATER and clear the controller of the
    // turn that replaced it, leaving the new turn uncancellable and letting the
    // dead one's status and rollback write over it. `ComposePanel` guarded this
    // exact way before it retired; the guard did not come across with the
    // machinery. Found by Copilot on PR 139.
    if (abort.current !== controller) return;
    abort.current = null;

    if (result.ok) {
      patchAnswer((turn) => ({ ...turn, pending: false }));
      setStatus("idle");
      return;
    }

    // Abandoned by "New conversation": its turn is already gone, and the user
    // asked for it. Not an error.
    if (result.error.code === ASK_ABORTED_CODE) return;

    // A turn that produced no text at all did not happen — drop both halves so
    // the thread stays a conversation rather than accumulating orphan
    // questions, and let the inline error carry the reason. A turn that got
    // PART of an answer out keeps it: the words are on screen already, and
    // deleting them under the user is the worse lie.
    if (streamed !== "") {
      patchAnswer((turn) => ({ ...turn, pending: false }));
    } else {
      setThread((current) => current.filter((t) => t.id !== answerId && t.id !== userTurn.id));
      // ...and the question goes back in the composer with it. A refusal the
      // user has to retype reads as the box being broken, and it is the
      // actionable 400s ("your message must be 4000 characters or fewer") that
      // make this more than a nicety: being told to shorten a message you can
      // no longer see is not actionable.
      setRestoredDraft(text);
    }
    setStatus("error");
    setAskError(errorMessageRef.current(result.error));
    setAskErrorCode(result.error.code ?? null);
  };

  const startNewConversation = () => {
    abort.current?.abort();
    abort.current = null;
    // **Forgotten, not just emptied**, and this is the only thing that forgets:
    // the save effect never removes (see its own note), so without this line a
    // "New conversation" would clear the screen and leave the old thread in
    // storage to come back on the next reload.
    if (persistAs !== undefined) clearAskThread(persistAs);
    setThread([]);
    setStatus("idle");
    setAskError(null);
    setAskErrorCode(null);
    setSimulated(false);
    setRestoredDraft(null);
  };

  /**
   * Hang up on the turn in flight, keeping the thread.
   *
   * Distinct from `startNewConversation`, which also empties it. A caller needs
   * this when the SURFACE goes away but the conversation has not: closing the
   * rail, or leaving Editing on a notebook page. Without it the request kept
   * streaming and its `page-inserts` still reached the editor — writing into a
   * document the user had just put back into Reading, and autosaving it.
   * Found by Copilot and CodeRabbit on PR 139.
   *
   * The pending answer is marked settled as well as aborted: the early return
   * in `runAsk` means nothing else will, and a thread reopened later would
   * otherwise show a turn that streams forever.
   */
  const cancel = () => {
    if (abort.current === null) return;
    abort.current.abort();
    abort.current = null;
    setThread((current) =>
      current.map((t) => (t.role === "assistant" && t.pending ? { ...t, pending: false } : t)),
    );
    setStatus("idle");
  };

  const refuse = (message: string) => {
    setStatus("error");
    setAskError(message);
    // A client-side refusal has no server code, and clearing it is what stops
    // a stale `ai-not-entitled` from turning the next unrelated refusal into an
    // upgrade prompt.
    setAskErrorCode(null);
    setSimulated(false);
  };

  const patchTurn = (turnId: string, fn: (turn: AssistantTurn) => AssistantTurn) =>
    setThread((current) => current.map((t) => (t.id === turnId ? fn(t) : t)));

  // The server refuses a body over `MAX_ASK_MESSAGES` with a 400, so this is
  // counted from the SAME filter `runAsk` applies when it builds `posted` — a
  // turn with no text is not on the wire — and the two cannot disagree about
  // what the server will see. Each answered question adds two messages, so
  // `(cap − posted + 1) / 2` is what is left: at 39 posted, one more question
  // fits (40) and none after it.
  const postedThreadLength = thread.filter((turn) => turn.text.trim() !== "").length;
  const asksRemaining = Math.max(0, Math.floor((MAX_ASK_MESSAGES - postedThreadLength + 1) / 2));

  return {
    thread,
    asking: status === "loading",
    askError: status === "error" ? askError : null,
    askErrorCode: status === "error" ? askErrorCode : null,
    simulated,
    asksRemaining,
    restoredDraft,
    runAsk,
    startNewConversation,
    cancel,
    refuse,
    patchTurn,
  };
}
