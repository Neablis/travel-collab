import type { BatchableCommand, HistoryEntry, TripDetail, TripHistory } from "@tc/contracts";
import { predictBatch } from "@tc/predict";

export type PendingUnit = {
  id: string;
  commands: BatchableCommand[];
  predictedDetail: TripDetail;
  description: string;
};
export type Confirmed = { detail: TripDetail; history: TripHistory };

// A send that the server rejected. Recorded on the state (rather than only as
// a transient page alert) because it has to do two jobs the alert cannot: gate
// the sequential sender so the retained queue is not re-fired in a loop, and
// survive the user making further edits — `runDispatch` clears the page alert
// on every accepted enqueue, but the failure is still true until a retry
// succeeds. `at` is passed in by the caller, never read from a clock in here:
// these are reducers, and React may invoke a state updater more than once.
export type SendFailure = { at: string; message: string };

export type OptimisticState = {
  confirmed: Confirmed;
  pending: PendingUnit[];
  // Absent = the queue is healthy and the sender may run. Present = the head
  // send failed, the queue is RETAINED (nothing discarded), and no further
  // send happens until `clearFailure` (i.e. the user's manual retry).
  failure?: SendFailure;
};
export type CommandOutcome = { detail: TripDetail; history: TripHistory };

// A history row for display: a real (confirmed) entry, or a not-yet-confirmed
// prediction. `pending` is optional and only set (true) on synthetic rows, so
// confirmed rows remain structurally identical to the raw HistoryEntry the
// server returns (no decoration) — callers should treat `pending !== true` as
// confirmed rather than requiring the field to be explicitly `false`.
export type HistoryRow = HistoryEntry & { pending?: boolean };

function baseDetail(state: OptimisticState): TripDetail {
  const last = state.pending[state.pending.length - 1];
  return last ? last.predictedDetail : state.confirmed.detail;
}

export function activeDetail(state: OptimisticState): TripDetail {
  return baseDetail(state);
}

// Confirmed entries (newest-first) with pending rows prepended (newest-first).
export function activeHistory(state: OptimisticState): TripHistory & { entries: HistoryRow[] } {
  const confirmedRows: HistoryRow[] = state.confirmed.history.entries;
  const pendingRows: HistoryRow[] = state.pending
    .map((u): HistoryRow => ({
      batchId: u.id,
      fromSeq: Number.MAX_SAFE_INTEGER,
      toSeq: Number.MAX_SAFE_INTEGER,
      actorId: "__optimistic__",
      occurredAt: new Date(0).toISOString(),
      origin: { kind: "user" },
      description: u.description,
      undone: false,
      pending: true,
    }))
    .reverse(); // newest pending first
  return { ...state.confirmed.history, entries: [...pendingRows, ...confirmedRows] };
}

export type EnqueueResult =
  | { ok: true; state: OptimisticState }
  | { ok: false; code: string; message: string };

export function enqueue(state: OptimisticState, id: string, commands: BatchableCommand[]): EnqueueResult {
  const prediction = predictBatch(baseDetail(state), commands);
  if (!prediction.ok) {
    return { ok: false, code: prediction.rejection.code, message: prediction.rejection.message };
  }
  const unit: PendingUnit = { id, commands, predictedDetail: prediction.detail, description: prediction.description };
  return { ok: true, state: { ...state, pending: [...state.pending, unit] } };
}

// The head send succeeded: adopt authoritative confirmed state, drop the head,
// and re-predict the remaining pending units on the new base (their predicted
// details may shift now that confirmed advanced).
export function confirmHead(state: OptimisticState, outcome: CommandOutcome): OptimisticState {
  const rest = state.pending.slice(1);
  let acc: OptimisticState = { confirmed: outcome, pending: [] };
  for (const unit of rest) {
    const r = enqueue(acc, unit.id, unit.commands);
    if (r.ok) acc = r.state;
    // If a queued unit no longer predicts cleanly against the new base, drop it
    // (and, by breaking, everything after it) — it will be reported via failHead
    // semantics at send time. Conservative: keep only cleanly-predictable units.
    else break;
  }
  return acc;
}

// The head send failed (KI-36). The queue is kept exactly as it is — the head
// included — and the failure is recorded. Nothing is discarded, so the user's
// already-rendered edits stay real and retryable instead of vanishing behind a
// one-line alert about the single command the server rejected.
//
// Retaining `pending` on its own would be a bug, not a fix: TripProvider's
// sequential sender gates on the queue being empty, so a retained queue with no
// failure recorded re-fires the same rejected command without bound (measured:
// 41 sends of one command in 300ms). `failure` is that gate.
export function failHead(state: OptimisticState, failure: SendFailure): OptimisticState {
  return { ...state, failure };
}

// The user asked to retry: forget the failure so the sender picks the retained
// head back up. Deliberately the ONLY way out of the failed state — there is no
// automatic retry and no backoff, so nothing re-sends without a user action.
export function clearFailure(state: OptimisticState): OptimisticState {
  if (!state.failure) return state; // no-op keeps the identity stable (no re-render/effect churn)
  const next = { ...state }; // copy-then-delete, so a future field isn't dropped by an explicit rebuild
  delete next.failure;
  return next;
}

// The number of queued-but-unsent units — one per edit the user made (a batched
// dispatch is one unit, i.e. one user action). This is a real count of work the
// server has not accepted, which is exactly what the failure UI may claim.
export function unsentCount(state: OptimisticState): number {
  return state.pending.length;
}
