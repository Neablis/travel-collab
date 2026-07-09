"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { TripDetail } from "@tc/contracts";
import { fetchTripDetail, sendTripCommand, type BoardCommand } from "@/lib/apiClient";
import type { ActivityFormValue } from "./ActivityEditor";
import { Board } from "./Board";

function StartDateControl({
  startDate,
  onSet,
}: {
  startDate: string | null;
  onSet: (value: string | null) => void;
}) {
  return (
    <p>
      <label>
        Start date:{" "}
        <input
          type="date"
          value={startDate ?? ""}
          onChange={(e) => onSet(e.target.value === "" ? null : e.target.value)}
        />
      </label>{" "}
      {startDate !== null && <button onClick={() => onSet(null)}>Clear</button>}
    </p>
  );
}

export function TripBoardScreen({ tripId }: { tripId: string }) {
  const [trip, setTrip] = useState<TripDetail | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "unauthenticated" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await fetchTripDetail(tripId);
    if (!result.ok) {
      setStatus(result.error.status === 401 ? "unauthenticated" : "error");
      setError(result.error.message);
      return;
    }
    setTrip(result.value);
    setStatus("ready");
  }, [tripId]);

  useEffect(() => {
    void load();
  }, [load]);

  const dispatch = useCallback(
    async (command: BoardCommand) => {
      setError(null);
      const result = await sendTripCommand(command);
      if (!result.ok) setError(result.error.message);
      // Refetch either way: conflicts are data and may have changed shape.
      await load();
    },
    [load],
  );

  if (status === "loading") return <main>Loading…</main>;
  if (status === "unauthenticated") {
    return (
      <main>
        <h1>travel-collab</h1>
        <Link href={`/api/auth/signin?callbackUrl=/trips/${tripId}`}>Sign in</Link>
      </main>
    );
  }
  if (status === "error" || trip === null) {
    return (
      <main>
        <p role="alert">{error ?? "Something went wrong"}</p>
        <Link href="/">← Your trips</Link>
      </main>
    );
  }

  return (
    <main>
      <nav>
        <Link href="/">← Your trips</Link>
      </nav>
      <h1>{trip.name}</h1>
      <StartDateControl
        startDate={trip.startDate}
        onSet={(startDate) => void dispatch({ type: "SetTripStartDate", tripId, startDate })}
      />
      {error !== null && <p role="alert">{error}</p>}
      <Board
        trip={trip}
        callbacks={{
          onMove: (activityId, toDayId, position) =>
            void dispatch({ type: "MoveActivity", tripId, activityId, toDayId, position }),
          onAddDay: () => void dispatch({ type: "AddDay", tripId, dayId: crypto.randomUUID() }),
          onRemoveDay: (dayId) => void dispatch({ type: "RemoveDay", tripId, dayId }),
          onAddActivity: (value: ActivityFormValue) =>
            void dispatch({
              type: "AddActivity",
              tripId,
              activityId: crypto.randomUUID(),
              title: value.title,
              timeWindow: value.timeWindow ?? undefined,
              location: value.location ?? undefined,
              notes: value.notes ?? undefined,
            }),
          onUpdateActivity: (activityId, value) =>
            void dispatch({
              type: "UpdateActivity",
              tripId,
              activityId,
              title: value.title,
              timeWindow: value.timeWindow,
              location: value.location,
              notes: value.notes,
            }),
          onRemoveActivity: (activityId) => void dispatch({ type: "RemoveActivity", tripId, activityId }),
        }}
      />
    </main>
  );
}
