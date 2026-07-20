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
import { activeDetail, activeHistory, confirmHead, enqueue, failHead, type OptimisticState } from "./optimistic";

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
    if (!optimistic || optimistic.pending.length === 0 || inFlight.current) return;
    const head = optimistic.pending[0]!;
    inFlight.current = true;
    (async () => {
      const result: { ok: true; value: CommandOutcome } | { ok: false; error: { message: string; code?: string } } =
        head.commands.length === 1
          ? await sendTripCommand(head.commands[0]! as BoardCommand)
          : await sendTripCommandBatch(tripId, head.commands);
      inFlight.current = false;
      setOptimistic((prev) => {
        if (!prev) return prev;
        if (result.ok) {
          setError(null);
          return confirmHead(prev, result.value);
        }
        // A "no-op" (e.g. re-setting a value to what it already is) changed
        // nothing — surfacing it as a page alert alarms the user for a
        // harmless action (#7HuQy). Treat it as a benign no-op: no error, and
        // the (already-applied-optimistically) head is simply confirmed away
        // against the existing confirmed state.
        if (result.error.code === "no-op") return confirmHead(prev, prev.confirmed);
        setError(result.error.message);
        return failHead(prev);
      });
    })();
  }, [optimistic, tripId]);

  const runDispatch = useCallback((commands: BatchableCommand[]) => {
    setError(null);
    setOptimistic((prev) => {
      if (!prev) return prev;
      const r = enqueue(prev, `c${++seq.current}`, commands);
      if (r.ok) return r.state;
      if (r.code !== "no-op") setError(r.message); // predicted rejection — no send
      return prev;
    });
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

  const dispatchBatch = useCallback(
    async (commands: BatchableCommand[]) => {
      runDispatch(commands);
    },
    [runDispatch],
  );

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
        preview: { seq: previewSeq, enter, exit },
      }}
    >
      {children}
    </Ctx.Provider>
  );
}
