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
  simulated: boolean;
  asksRemaining: number;
  restoredDraft: string | null;
  /** Posts a turn. Deliberately not awaited by callers — see the board's own note. */
  runAsk: (text: string) => Promise<void>;
  startNewConversation: () => void;
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

export function useAskThread({
  tripId,
  scope,
  onEvent,
  errorMessage,
}: {
  tripId: string;
  scope: AskScope;
  onEvent?: AskEventHandler;
  /** How this surface words a transport failure. */
  errorMessage: (error: ApiError) => string;
}): AskThread {
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [askError, setAskError] = useState<string | null>(null);
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
  // Runs on unmount only, so it must not be keyed on anything that changes.
  useEffect(() => () => abort.current?.abort(), []);

  // `onEvent` is called from inside a stream that outlives the render it
  // started in. A ref keeps the CURRENT handler without making `runAsk` depend
  // on a callback identity every caller would then have to memoise.
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const errorMessageRef = useRef(errorMessage);
  errorMessageRef.current = errorMessage;

  const nextTurnId = (prefix: string) => {
    turnSeq.current += 1;
    return `${prefix}${turnSeq.current}`;
  };

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
  };

  const startNewConversation = () => {
    abort.current?.abort();
    abort.current = null;
    setThread([]);
    setStatus("idle");
    setAskError(null);
    setSimulated(false);
    setRestoredDraft(null);
  };

  const refuse = (message: string) => {
    setStatus("error");
    setAskError(message);
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
    simulated,
    asksRemaining,
    restoredDraft,
    runAsk,
    startNewConversation,
    refuse,
    patchTurn,
  };
}
