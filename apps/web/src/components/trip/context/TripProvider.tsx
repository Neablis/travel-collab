"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { TripDetail, TripHistory } from "@tc/contracts";
import { fetchTripDetail, fetchTripDetailAt, fetchTripHistory, sendTripCommand, type BoardCommand } from "@/lib/apiClient";

type Status = "loading" | "ready" | "unauthenticated" | "error";
type TripCtx = {
  trip: TripDetail | null;
  history: TripHistory | null;
  activeTrip: TripDetail | null;
  status: Status;
  error: string | null;
  pending: boolean;
  dispatch: (command: BoardCommand) => Promise<void>;
  preview: { seq: number | null; enter: (seq: number) => Promise<void>; exit: () => void };
};

const Ctx = createContext<TripCtx | null>(null);
export const useTrip = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTrip outside TripProvider");
  return v;
};

export function TripProvider({ tripId, children }: { tripId: string; children: React.ReactNode }) {
  const [trip, setTrip] = useState<TripDetail | null>(null);
  const [history, setHistory] = useState<TripHistory | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [previewSeq, setPreviewSeq] = useState<number | null>(null);
  const [previewTrip, setPreviewTrip] = useState<TripDetail | null>(null);

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
    setTrip(detailResult.value);
    setHistory(historyResult.ok ? historyResult.value : null);
    setStatus("ready");
  }, [tripId]);

  useEffect(() => {
    void load();
  }, [load]);

  const enter = useCallback(
    async (seq: number) => {
      const result = await fetchTripDetailAt(tripId, seq);
      if (result.ok) {
        setPreviewSeq(seq);
        setPreviewTrip(result.value);
      } else {
        setError(result.error.message);
      }
    },
    [tripId],
  );

  const exit = useCallback(() => {
    setPreviewSeq(null);
    setPreviewTrip(null);
  }, []);

  const dispatch = useCallback(
    async (command: BoardCommand) => {
      setError(null);
      setPending(true);
      try {
        const result = await sendTripCommand(command);
        if (!result.ok) setError(result.error.message);
        // Event log is the source of truth — refetch either way, never mutate context state directly.
        await load();
        exit();
      } finally {
        setPending(false);
      }
    },
    [load, exit],
  );

  const activeTrip = previewSeq !== null && previewTrip !== null ? previewTrip : trip;

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
        preview: { seq: previewSeq, enter, exit },
      }}
    >
      {children}
    </Ctx.Provider>
  );
}
