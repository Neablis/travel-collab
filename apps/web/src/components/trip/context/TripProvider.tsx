"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { BatchableCommand, TripDetail, TripHistory, TripRole } from "@tc/contracts";
import { usePublishSaveState } from "@/components/SaveLight";
import {
  fetchTripAccess,
  fetchTripDetail,
  fetchTripDetailAt,
  fetchTripHistory,
  sendTripCommand,
  sendTripCommandBatch,
  type BoardCommand,
  type CommandOutcome,
} from "@/lib/apiClient";
import {
  activeDetail,
  activeHistory,
  clearFailure,
  confirmHead,
  enqueue,
  failHead,
  unsentCount,
  type OptimisticState,
  type SendFailure,
} from "./optimistic";

type Status = "loading" | "ready" | "unauthenticated" | "error";
type TripCtx = {
  // The trip this provider is for. Exposed because several controls need it
  // to talk to an endpoint rather than to read state — `trip` is null while
  // loading and during an error, and those controls still know which trip
  // they belong to (M11 link 6's AddSavedDayButton is the first).
  tripId: string;
  trip: TripDetail | null;
  history: TripHistory | null;
  activeTrip: TripDetail | null;
  status: Status;
  error: string | null;
  pending: boolean;
  dispatch: (command: BoardCommand) => Promise<void>;
  dispatchBatch: (commands: BatchableCommand[]) => Promise<void>;
  // Replace confirmed state with an authoritative outcome the client didn't
  // predict — the AI planning batch is decided server-side, so the client
  // never held those commands to optimistically predict from. The AI response
  // already carries the resulting detail + history, so we reconcile directly
  // from it (no refetch round-trip) — same shape as how undo/redo/revert
  // reconcile from their command response below.
  applyOutcome: (outcome: CommandOutcome) => void;
  // The signed-in user's role on this trip (M11 link 3), or null while it is
  // still loading or the read failed. ADVISORY ONLY: the server refuses every
  // write from a viewer regardless (accessPolicy.ts + pages-guard.ts), and
  // this exists so the board can say "View only" instead of letting someone
  // drag a card and watch it snap back with a 403.
  myRole: TripRole | null;
  readOnly: boolean;
  // True once the access read has completed and FAILED — not while it is still
  // in flight. See `load()` for why the failure stays non-fatal, and TripHeader
  // for where it is said out loud.
  accessUnknown: boolean;
  // KI-36: the send queue's honest failure surface. `unsent` is the live count
  // of queued units the server has NOT accepted (retained, not discarded);
  // `failure` carries when the send failed and what the server said; `retry`
  // is the only thing that resumes sending. Retry is manual by design — there
  // is no timer, no backoff, and nothing re-sends on its own.
  sync: { unsent: number; failure: SendFailure | null; retry: () => void };
  preview: { seq: number | null; enter: (seq: number) => Promise<void>; exit: () => void };
};

const Ctx = createContext<TripCtx | null>(null);
export const useTrip = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTrip outside TripProvider");
  return v;
};

// History commands (undo/redo/revert) are NOT optimistically predicted — they
// depend on the full event log, which the client does not hold. They're sent
// directly and reconciled from the authoritative response, and refuse to run
// while anything is pending (don't interleave with unconfirmed optimistic edits).
const HISTORY_TYPES = new Set(["UndoLastChange", "RedoChange", "RevertToState"]);

export function TripProvider({ tripId, children }: { tripId: string; children: React.ReactNode }) {
  const [optimistic, setOptimistic] = useState<OptimisticState | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<TripRole | null>(null);
  const [accessUnknown, setAccessUnknown] = useState(false);
  const [previewSeq, setPreviewSeq] = useState<number | null>(null);
  const [previewTrip, setPreviewTrip] = useState<TripDetail | null>(null);
  const seq = useRef(0);
  // Mirrors `optimistic` so `runDispatch` can predict against the CURRENT queue
  // without taking it as a dependency. Two things depend on that: the callback
  // keeps a stable identity (a drag captures it once and must not see it swap
  // mid-gesture), and a second dispatch in the same tick chains off the first
  // instead of re-reading a render-old value. Both broke the unscheduled-rack
  // drag when this was written as a plain dependency.
  const optimisticRef = useRef<OptimisticState | null>(null);

  const load = useCallback(async () => {
    try {
      const [detailResult, historyResult, accessResult] = await Promise.all([
        fetchTripDetail(tripId),
        fetchTripHistory(tripId),
        // Failure here is deliberately non-fatal: `myRole` stays null and the
        // board behaves exactly as it did before roles existed. The server is
        // the boundary; this read only decides what the UI *offers*.
        fetchTripAccess(tripId),
      ]);
      setMyRole(accessResult.ok ? accessResult.value.myRole : null);
      // Reviewed and kept non-fatal, deliberately, against the alternative
      // (docs/reviews/2026-08-28-m11-pr71-review.md §5's PLAUSIBLE edge): a
      // failed access read for a real VIEWER leaves the board live, and every
      // write they then attempt 403s into a retained queue whose retry can
      // never succeed. Treating an unknown role as read-only would fix that
      // case and break the commoner one — an OWNER locked out of their own
      // trip by one 500 on a secondary read, with no way back but a reload.
      // A false "view only" is the worse failure, and it would be the more
      // frequent one, so the failure is surfaced rather than acted on:
      // `accessUnknown` is what TripHeader says out loud, so a later refusal
      // is expected rather than mystifying. The security boundary is
      // unchanged either way — the server refuses every write independently
      // (accessPolicy.ts), and it is the only thing that ever did.
      setAccessUnknown(!accessResult.ok);
      if (!detailResult.ok) {
        setStatus(detailResult.error.status === 401 ? "unauthenticated" : "error");
        setError(detailResult.error.message);
        return;
      }
      setOptimistic({
        confirmed: {
          detail: detailResult.value,
          history: historyResult.ok
            ? historyResult.value
            : { tripId, entries: [], canUndo: false, canRedo: false },
        },
        pending: [],
      });
      setStatus("ready");
    } catch (err) {
      // `status` has exactly one terminal-looking value that renders nothing
      // and says nothing — "loading" — so any throw that escapes here leaves
      // a permanent spinner with no error and no retry
      // (docs/reviews/2026-08-28-project-review.md §1.1, second site). The
      // apiClient helpers resolve rather than reject now, which makes this
      // unreachable through them; it is kept because the cost of being wrong
      // about that is a page that never loads and never explains itself.
      setStatus("error");
      setError(err instanceof Error ? err.message : "Could not load this trip.");
    }
  }, [tripId]);

  useEffect(() => {
    void load();
  }, [load]);

  const exit = useCallback(() => {
    setPreviewSeq(null);
    setPreviewTrip(null);
  }, []);

  const pending = (optimistic?.pending.length ?? 0) > 0;

  const enter = useCallback(
    async (seqArg: number) => {
      if (pending) return; // cannot branch history preview from unconfirmed state
      const result = await fetchTripDetailAt(tripId, seqArg);
      if (result.ok) {
        setPreviewSeq(seqArg);
        setPreviewTrip(result.value);
      } else {
        setError(result.error.message);
      }
    },
    [tripId, pending],
  );

  // Sequential sender: whenever there is a pending head and nothing already in
  // flight, send the head; reconcile or roll back on its result. Only one send
  // is ever in flight — `inFlight` is a ref (not state) so re-renders that fire
  // while a send is outstanding don't kick off a second send for the same head.
  const inFlight = useRef(false);
  useEffect(() => {
    // The `failure` clause is load-bearing (KI-36): now that a failed send
    // RETAINS its queue, emptiness alone no longer stops the sender, and
    // without this the effect re-fires on the retained head and re-sends the
    // same rejected command without bound. Only `retry()` lifts the gate.
    if (!optimistic || optimistic.pending.length === 0 || optimistic.failure || inFlight.current) return;
    const head = optimistic.pending[0]!;
    inFlight.current = true;
    (async () => {
      let result: { ok: true; value: CommandOutcome } | { ok: false; error: { message: string; code?: string } };
      try {
        result =
          head.commands.length === 1
            ? await sendTripCommand(head.commands[0]! as BoardCommand)
            : await sendTripCommandBatch(tripId, head.commands);
      } catch (err) {
        // A throw here is a failed send like any other, and is treated as one
        // so the user gets KI-36's retained queue and manual retry. It should
        // be unreachable — every apiClient helper resolves rather than
        // rejects (see its module invariant) — but this is the site where
        // being wrong was catastrophic: the reset below was skipped, the
        // sender stayed gated for the life of the page, and every queued edit
        // was lost on navigation with the header still saying "Saving…"
        // (docs/reviews/2026-08-28-project-review.md §1.1).
        result = { ok: false, error: { message: err instanceof Error ? err.message : "Network error" } };
      } finally {
        // Unconditional, and the whole point of the try/finally: nothing on
        // any path may leave the sequential sender permanently in flight.
        inFlight.current = false;
      }
      // Built out here, not inside the updater below: `new Date()` is a
      // wall-clock read and updaters must stay pure (React may invoke them
      // more than once), which is the same reason setError is decided out
      // here. `failHead` takes the timestamp as a parameter and never reads a
      // clock itself, so the reducer stays testable with a fixed instant.
      const failure: SendFailure | null =
        result.ok || result.error.code === "no-op"
          ? null
          : { at: new Date().toISOString(), message: result.error.message };
      setOptimistic((prev) => {
        if (!prev) return prev;
        if (result.ok) {
          return confirmHead(prev, result.value);
        }
        // A "no-op" (e.g. re-setting a value to what it already is) changed
        // nothing — surfacing it as a page alert alarms the user for a
        // harmless action (#7HuQy). Treat it as a benign no-op: no error, and
        // the (already-applied-optimistically) head is simply confirmed away
        // against the existing confirmed state. `failure === null` on a failed
        // result means exactly this case.
        if (!failure) return confirmHead(prev, prev.confirmed);
        return failHead(prev, failure);
      });
      // Decided from `result` (already known, outer scope) rather than from
      // inside the setOptimistic updater above — updater functions must stay
      // pure, since React may invoke them more than once.
      if (result.ok) {
        setError(null);
      } else if (result.error.code !== "no-op") {
        setError(result.error.message);
      }
    })();
  }, [optimistic, tripId]);

  // A viewer holds read access and executes no planning command at all
  // (accessPolicy.ts's MINIMUM_ROLE table has no "viewer" entry). Stopping
  // here rather than at the network means the optimistic queue never predicts
  // a change that is going to be refused — which is what would otherwise make
  // a card visibly move and then jump back.
  const readOnly = myRole === "viewer";

  const runDispatch = useCallback((commands: BatchableCommand[]) => {
    if (readOnly) {
      setError("You have view-only access to this trip.");
      return;
    }
    // Predicted OUTSIDE the updater, against `optimistic` from this render.
    //
    // It used to be computed inside `setOptimistic`, assigning to a `let` that
    // the line after the call then read. React does not run an updater
    // synchronously — updaters run in the render phase — so that read always
    // saw `null` and EVERY predicted rejection was silent: no send, no
    // message, a click that did nothing. Mitchell hit this walking the #71
    // preview: a trip whose state rejects every command (a deleted one, say,
    // which `decideCommand` refuses wholesale) looked simply inert.
    //
    // The send effect above already computes its failure in the outer scope
    // for exactly this reason and says so — "updater functions must stay pure,
    // since React may invoke them more than once". This is that rule applied
    // to the path that was still breaking it.
    const base = optimisticRef.current;
    if (!base) return;
    const result = enqueue(base, `c${++seq.current}`, commands);
    if (!result.ok) {
      // A no-op changed nothing, which is not worth alarming anyone about —
      // the same judgement the send effect makes on the server's own no-op.
      setError(result.code === "no-op" ? null : result.message);
      return;
    }
    // Advanced before `setOptimistic` so anything dispatched later in this same
    // tick predicts against this result rather than the pre-dispatch queue.
    optimisticRef.current = result.state;
    setError(null);
    setOptimistic(result.state);
  }, [readOnly]);

  const dispatch = useCallback(
    async (command: BoardCommand) => {
      if (readOnly) {
        setError("You have view-only access to this trip.");
        return;
      }
      if (HISTORY_TYPES.has(command.type)) {
        if (pending) return;
        setError(null);
        const result = await sendTripCommand(command);
        if (!result.ok) {
          if (result.error.code !== "no-op") setError(result.error.message);
          return;
        }
        setOptimistic((prev) => (prev ? { confirmed: result.value, pending: [] } : prev));
        exit();
        return;
      }
      runDispatch([command as BatchableCommand]);
    },
    [runDispatch, pending, exit, readOnly],
  );

  // KI-36: the manual retry. Clearing the failure is all it takes — the
  // sequential sender's effect re-runs on the new state and picks the retained
  // head back up. No re-enqueue, no re-prediction: the queue never left.
  const retry = useCallback(() => {
    setError(null);
    setOptimistic((prev) => (prev ? clearFailure(prev) : prev));
  }, []);

  const dispatchBatch = useCallback(
    async (commands: BatchableCommand[]) => {
      runDispatch(commands);
    },
    [runDispatch],
  );

  const applyOutcome = useCallback((outcome: CommandOutcome) => {
    // `outcome` is `{ detail, history }` — exactly the `confirmed` shape. Clear
    // pending: this is authoritative server state, nothing local is unconfirmed
    // relative to it (matches the undo/redo/revert reconciliation).
    //
    // PRECONDITION, on the caller: only apply an outcome when `pending` is
    // empty. The server decided this outcome without seeing anything still
    // queued here, so clearing discards those units from the UI as well as
    // from the server — the same silent loss `dispatch` refuses to cause
    // below (`if (pending) return`). Callers gate their own affordance rather
    // than being refused here, so the user is told why instead of watching a
    // control do nothing: AddSavedDayButton disables the button, and
    // TripBoardScreen's assistant ask reports it in the rail
    // (docs/reviews/2026-08-28-m11-pr71-review.md §4).
    setOptimistic((prev) => (prev ? { confirmed: outcome, pending: [] } : prev));
    setError(null);
  }, []);

  // Kept in step with the state on every render, so a change made anywhere
  // else — the initial load, the sender confirming a head, applyOutcome,
  // retry — is what the next dispatch predicts against.
  optimisticRef.current = optimistic;

  const confirmedDetail = optimistic ? activeDetail(optimistic) : null;
  const history: TripHistory | null = optimistic ? activeHistory(optimistic) : null;
  const trip = optimistic?.confirmed.detail ?? null;
  const activeTrip = previewSeq !== null && previewTrip !== null ? previewTrip : confirmedDetail;

  // One object for the context and for the header's save light, so the two
  // can never disagree about whether there is unsent work.
  const sync = useMemo(
    () => ({ unsent: optimistic ? unsentCount(optimistic) : 0, failure: optimistic?.failure ?? null, retry }),
    [optimistic, retry],
  );

  return (
    <Ctx.Provider
      value={{
        tripId,
        trip,
        history,
        activeTrip,
        status,
        error,
        pending,
        dispatch,
        dispatchBatch,
        applyOutcome,
        myRole,
        readOnly,
        accessUnknown,
        sync,
        preview: { seq: previewSeq, enter, exit },
      }}
    >
      {/* The header logo is the save light (SPEC "The logo is the save
          light"), and it renders above this provider, so the state has to be
          published upward rather than read down. Done here rather than in
          TripHeader because it is the provider that owns the value — and
          because TripHeader returns early while the trip is loading, which is
          exactly when "saving…" matters. */}
      <PublishSaveState sync={sync} />
      {children}
    </Ctx.Provider>
  );
}

// A component rather than a bare `usePublishSaveState(sync)` call inside
// TripProvider: the hook subscribes to the SaveLight context, and calling it
// in the provider body would re-render the whole trip tree whenever the light
// changed. As a leaf with no children, it re-renders alone.
function PublishSaveState({ sync }: { sync: { unsent: number; failure: SendFailure | null; retry: () => void } }) {
  usePublishSaveState(sync);
  return null;
}
