"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { TripDetail, TripHistory } from "@tc/contracts";
import {
  fetchTripDetail,
  fetchTripDetailAt,
  fetchTripHistory,
  sendTripCommand,
  type BoardCommand,
} from "@/lib/apiClient";
import { CalendarLens } from "@/components/lenses/CalendarLens";
import { MapLens } from "@/components/lenses/MapLens";
import { TimelineLens } from "@/components/lenses/TimelineLens";
import { ActivityEditor, type ActivityFormValue } from "./ActivityEditor";
import { Board } from "./Board";
import { HistoryPanel } from "./HistoryPanel";
import { UndoRedoControls } from "./UndoRedoControls";

const LENSES = ["Board", "Map", "Timeline", "Calendar"] as const;
type Lens = (typeof LENSES)[number];

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
  const [history, setHistory] = useState<TripHistory | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "unauthenticated" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

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

  const [lens, setLens] = useState<Lens>("Board");
  const [editingActivityId, setEditingActivityId] = useState<string | null>(null);

  const [previewSeq, setPreviewSeq] = useState<number | null>(null);
  const [previewTrip, setPreviewTrip] = useState<TripDetail | null>(null);

  const openPreview = useCallback(
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

  const exitPreview = useCallback(() => {
    setPreviewSeq(null);
    setPreviewTrip(null);
  }, []);

  const dispatch = useCallback(
    async (command: BoardCommand) => {
      setError(null);
      const result = await sendTripCommand(command);
      if (!result.ok) setError(result.error.message);
      // Refetch either way: conflicts are data and may have changed shape.
      await load();
      exitPreview();
    },
    [load, exitPreview],
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

  const activeTrip = previewSeq !== null && previewTrip !== null ? previewTrip : trip;
  const editingActivity = editingActivityId !== null ? (activeTrip.activities[editingActivityId] ?? null) : null;

  const updateActivity = (activityId: string, value: ActivityFormValue) =>
    void dispatch({
      type: "UpdateActivity",
      tripId,
      activityId,
      title: value.title,
      timeWindow: value.timeWindow,
      location: value.location,
      notes: value.notes,
      anchors: value.anchors,
    });

  return (
    <main>
      <nav>
        <Link href="/">← Your trips</Link>
      </nav>
      <h1>{trip.name}</h1>
      {previewSeq === null && (
        <StartDateControl
          startDate={trip.startDate}
          onSet={(startDate) => void dispatch({ type: "SetTripStartDate", tripId, startDate })}
        />
      )}
      {previewSeq === null && (
        <UndoRedoControls
          canUndo={history?.canUndo ?? false}
          canRedo={history?.canRedo ?? false}
          onUndo={() => void dispatch({ type: "UndoLastChange", tripId })}
          onRedo={() => void dispatch({ type: "RedoChange", tripId })}
        />
      )}
      <HistoryPanel
        history={history}
        previewSeq={previewSeq}
        onPreview={(seq) => void openPreview(seq)}
        onExitPreview={exitPreview}
        onRevert={(toSeq) => void dispatch({ type: "RevertToState", tripId, toSeq })}
      />
      {error !== null && <p role="alert">{error}</p>}
      <div role="tablist" aria-label="Trip view">
        {LENSES.map((l) => (
          <button
            key={l}
            type="button"
            role="tab"
            aria-selected={lens === l}
            onClick={() => setLens(l)}
          >
            {l}
          </button>
        ))}
      </div>
      <div inert={previewSeq !== null ? true : undefined}>
        {lens === "Board" && (
          <Board
            trip={activeTrip}
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
                  anchors: value.anchors,
                }),
              onUpdateActivity: updateActivity,
              onRemoveActivity: (activityId) => void dispatch({ type: "RemoveActivity", tripId, activityId }),
              onDismissConflict: (conflictId) => void dispatch({ type: "DismissConflict", tripId, conflictId }),
            }}
          />
        )}
        {lens === "Map" && <MapLens detail={activeTrip} onSelectActivity={setEditingActivityId} />}
        {lens === "Timeline" && <TimelineLens detail={activeTrip} onSelectActivity={setEditingActivityId} />}
        {lens === "Calendar" && (
          <CalendarLens
            detail={activeTrip}
            onCommand={(command) => {
              if (command.type !== "CreateTrip") void dispatch(command);
            }}
            onSelectActivity={setEditingActivityId}
          />
        )}
        {lens !== "Board" && editingActivityId !== null && editingActivity !== null && (
          <div style={{ marginTop: 12, maxWidth: 420 }}>
            <ActivityEditor
              initial={editingActivity}
              onSave={(value) => {
                updateActivity(editingActivityId, value);
                setEditingActivityId(null);
              }}
              onCancel={() => setEditingActivityId(null)}
            />
          </div>
        )}
      </div>
    </main>
  );
}
