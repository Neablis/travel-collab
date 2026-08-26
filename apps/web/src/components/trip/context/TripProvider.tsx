"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { BatchableCommand, TripDetail, TripHistory } from "@tc/contracts";
import {
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
  const [previewSeq, setPreviewSeq] = useState<number | null>(null);
  const [previewTrip, setPreviewTrip] = useState<TripDetail | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const [detailResult, historyResult] = await Promise.all([
      fetchTripDetail(tripId),
      fetchTripHistory(tripId),
    ]);
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
      const result: { ok: true; value: CommandOutcome } | { ok: false; error: { message: string; code?: string } } =
        head.commands.length === 1
          ? await sendTripCommand(head.commands[0]! as BoardCommand)
          : await sendTripCommandBatch(tripId, head.commands);
      inFlight.current = false;
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

  const runDispatch = useCallback((commands: BatchableCommand[]) => {
    // `rejectionMessage` is populated (deterministically, from `prev`) inside
    // the updater below, but setError itself is only ever invoked once, here,
    // after setOptimistic returns — keeps the updater free of side effects.
    let rejectionMessage: string | null = null;
    setOptimistic((prev) => {
      if (!prev) return prev;
      const r = enqueue(prev, `c${++seq.current}`, commands);
      if (r.ok) return r.state;
      if (r.code !== "no-op") rejectionMessage = r.message; // predicted rejection — no send
      return prev;
    });
    setError(rejectionMessage);
  }, []);

  const dispatch = useCallback(
    async (command: BoardCommand) => {
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
    [runDispatch, pending, exit],
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
    setOptimistic((prev) => (prev ? { confirmed: outcome, pending: [] } : prev));
    setError(null);
  }, []);

  const confirmedDetail = optimistic ? activeDetail(optimistic) : null;
  const history: TripHistory | null = optimistic ? activeHistory(optimistic) : null;
  const trip = optimistic?.confirmed.detail ?? null;
  const activeTrip = previewSeq !== null && previewTrip !== null ? previewTrip : confirmedDetail;

  return (
    <Ctx.Provider
      value={{
        trip,
        history,
        activeTrip,
        status,
        error,
        pending,
        dispatch,
        dispatchBatch,
        applyOutcome,
        sync: { unsent: optimistic ? unsentCount(optimistic) : 0, failure: optimistic?.failure ?? null, retry },
        preview: { seq: previewSeq, enter, exit },
      }}
    >
      {children}
    </Ctx.Provider>
  );
}
