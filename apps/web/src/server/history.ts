import type { TripDetail, TripHistory } from "@tc/contracts";
import {
  buildHistoryEntries,
  deriveUndoRedo,
  foldEnvelopes,
  groupBatches,
  tripDetailFromState,
} from "@tc/domain";
import { serverConflictContext } from "./conflictContext";
import { demoTripDetailAt, demoTripHeadSeq, demoTripHistory } from "./demoTrip";
import { isDemoTripId } from "@/lib/demoTrip";
import { db } from "./db/client";
import { readStream } from "./eventStore";

// Read-side of ADR-005: both queries are pure replays of the log — no new
// storage. Route handlers may not import @tc/domain (lint wall); they call this.
export async function getTripHistory(tripId: string): Promise<TripHistory | null> {
  // The demo trip's stream is built in memory, not stored (ADR-031) — but it
  // is a real envelope list, so its history came out of the same
  // `buildHistoryEntries` this function calls two lines down.
  if (isDemoTripId(tripId)) return demoTripHistory();
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

/** How many events the trip's stream carries, or null if it has none. */
export async function getTripHead(tripId: string): Promise<number | null> {
  if (isDemoTripId(tripId)) return demoTripHeadSeq();
  const envelopes = await readStream(db, tripId);
  return envelopes.length === 0 ? null : envelopes.length;
}

export async function getTripDetailAt(tripId: string, seq: number): Promise<TripDetail | null> {
  return (await getTripDetailAtWithHead(tripId, seq))?.detail ?? null;
}

/**
 * The same replay, plus how long the stream is now.
 *
 * A pinned share (M11 link 4) needs both from one read: the trip as of the
 * pinned seq, and whether the trip has moved on since — and reading the
 * stream twice to answer two questions about the same read would be the
 * public read path paying double on every view.
 */
export async function getTripDetailAtWithHead(
  tripId: string,
  seq: number,
): Promise<{ detail: TripDetail; headSeq: number } | null> {
  if (isDemoTripId(tripId)) {
    const detail = demoTripDetailAt(seq);
    return detail === null ? null : { detail, headSeq: demoTripHeadSeq() };
  }
  const envelopes = await readStream(db, tripId);
  if (envelopes.length === 0 || !Number.isInteger(seq) || seq < 1 || seq > envelopes.length) {
    return null;
  }
  const state = foldEnvelopes(envelopes, seq);
  if (state === null) return null;
  return {
    detail: tripDetailFromState(state, envelopes[0]!.occurredAt, serverConflictContext()),
    headSeq: envelopes.length,
  };
}
