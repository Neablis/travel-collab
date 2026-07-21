import type { BatchableCommand, HistoryEntry, TripDetail, TripHistory } from "@tc/contracts";
import { predictBatch } from "@tc/predict";

export type PendingUnit = {
  id: string;
  commands: BatchableCommand[];
  predictedDetail: TripDetail;
  description: string;
};
export type Confirmed = { detail: TripDetail; history: TripHistory };
export type OptimisticState = { confirmed: Confirmed; pending: PendingUnit[] };
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

// The head send failed: drop the head and everything queued behind it (they were
// predicted on a state that will never exist). Confirmed state is untouched.
export function failHead(state: OptimisticState): OptimisticState {
  return { ...state, pending: [] };
}
