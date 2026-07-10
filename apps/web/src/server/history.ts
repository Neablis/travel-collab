import type { TripDetail, TripHistory } from "@tc/contracts";
import {
  buildHistoryEntries,
  deriveUndoRedo,
  foldEnvelopes,
  groupBatches,
  tripDetailFromState,
} from "@tc/domain";
import { serverConflictContext } from "./conflictContext";
import { db } from "./db/client";
import { readStream } from "./eventStore";

// Read-side of ADR-005: both queries are pure replays of the log — no new
// storage. Route handlers may not import @tc/domain (lint wall); they call this.
export async function getTripHistory(tripId: string): Promise<TripHistory | null> {
  const envelopes = await readStream(db, tripId);
  if (envelopes.length === 0) return null;
  const targets = deriveUndoRedo(groupBatches(envelopes));
  return {
    tripId,
    entries: buildHistoryEntries(envelopes).reverse(),
    canUndo: targets.undo !== null,
    canRedo: targets.redo !== null,
  };
}

export async function getTripDetailAt(tripId: string, seq: number): Promise<TripDetail | null> {
  const envelopes = await readStream(db, tripId);
  if (envelopes.length === 0 || !Number.isInteger(seq) || seq < 1 || seq > envelopes.length) {
    return null;
  }
  const state = foldEnvelopes(envelopes, seq);
  if (state === null) return null;
  return tripDetailFromState(state, envelopes[0]!.occurredAt, serverConflictContext());
}
