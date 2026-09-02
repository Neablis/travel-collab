import type { BatchableCommand, HistoryEntry, TripDetail, TripHistory } from "@tc/contracts";
import { predictBatch } from "@tc/predict";

export type PendingUnit = {
  id: string;
  commands: BatchableCommand[];
  // The client's prediction of what this unit does, or `null` when the unit is
  // queued but NOT currently predictable against the confirmed state (KI-42):
  // `confirmHead` adopted an authoritative outcome the unit's commands no
  // longer read cleanly against. `null` is a display fact only — the unit is
  // still real, unsent work: it stays in `pending`, it is still counted by
  // `unsentCount`, and the sender still sends it, so the server (not this
  // client's guess) decides its fate. What `null` costs is the optimistic
  // preview: an unpredictable unit contributes nothing to `activeDetail`,
  // because the alternative is showing a prediction computed against a base
  // the server has since replaced.
  predictedDetail: TripDetail | null;
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

// The newest state anything should predict or render from: the last queued
// unit that HAS a prediction, else confirmed. Scans backwards rather than
// reading `pending[length - 1]` because the tail may be units retained without
// a prediction (KI-42) — those carry no detail to show, so the last predicted
// unit before them is still the truest picture of the trip.
//
// That is only true because unpredicted units are a strict SUFFIX of `pending`
// (KI-55). `confirmHead` establishes the invariant — once a unit fails to
// re-predict, every unit behind it is retained unpredicted too — and `enqueue`
// preserves it by refusing to predict over a queue that already holds one. If
// a predicted unit could sit behind an unpredicted one, this backwards scan
// would return a detail computed over a base that skips real, still-queued
// work, and the caller would render a trip no send is ever going to produce.
function baseDetail(state: OptimisticState): TripDetail {
  for (let i = state.pending.length - 1; i >= 0; i--) {
    const predicted = state.pending[i]!.predictedDetail;
    if (predicted) return predicted;
  }
  return state.confirmed.detail;
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

// Queue one unit of work, predicted against the trip as currently rendered.
//
// KI-55: if the queue ALREADY holds a unit retained without a prediction
// (KI-42), this unit is queued unpredicted too. The prediction is still
// computed — a command that cannot apply to the screen the user is looking at
// is still rejected here, and its `description` is still what names the unit
// in the pending history — but the predicted detail is discarded rather than
// stored, because storing it would put a predicted unit BEHIND an unpredicted
// one. `baseDetail` would then read it and render authoritative-plus-this-one:
// a trip missing the earlier retained work, which is not any prefix of the
// queue and so is not a trip any send produces. The queue is sent in order, so
// the only honest previews are prefixes of it.
//
// What this costs is real and deliberate: while the queue is unpredictable the
// board stops moving under the user's edits. It does not go silent — the unit
// is queued, counted by `unsentCount`, sent in order, and shown by
// `activeHistory` as a pending row with this description, exactly like the
// retained units ahead of it. The board resumes as soon as the queue drains.
export function enqueue(state: OptimisticState, id: string, commands: BatchableCommand[]): EnqueueResult {
  const prediction = predictBatch(baseDetail(state), commands);
  if (!prediction.ok) {
    return { ok: false, code: prediction.rejection.code, message: prediction.rejection.message };
  }
  const blocked = state.pending.some((u) => u.predictedDetail === null);
  const unit: PendingUnit = {
    id,
    commands,
    predictedDetail: blocked ? null : prediction.detail,
    description: prediction.description,
  };
  return { ok: true, state: { ...state, pending: [...state.pending, unit] } };
}

// The head send succeeded: adopt authoritative confirmed state, drop the head,
// and re-predict the remaining pending units on the new base (their predicted
// details may shift now that confirmed advanced).
//
// KI-42: a unit that no longer predicts cleanly against the new base is KEPT,
// not dropped — and so is everything queued behind it. This function used to
// `break` out of the loop on the first re-prediction failure, discarding that
// unit and every later one, on the claim that the loss "will be reported via
// failHead semantics at send time". It could not be: the units were removed
// from `pending`, so they were never sent and `failHead` never saw them. Work
// the user had already been shown as applied vanished on a *successful* save
// with no alert, no count and no retry — the same silent-loss class as KI-5
// and KI-36, on the one trigger neither covers.
//
// Retaining them makes that claim true rather than deleting it: the units stay
// queued in order, the sender sends them, and the server decides. If it
// refuses one, `failHead` records a real server message and lights the save
// mark red with a retry. If it accepts (the client's local re-prediction can
// be more conservative than the server's own decision), the work survives.
// Either way nothing disappears without something saying so.
//
// Everything after the first unpredictable unit is retained unpredicted too,
// even if it would predict cleanly on its own: these are ordered edits, and
// predicting a later one against a base that skips an earlier one would show
// the user a trip that no send is ever going to produce.
//
// That guarantee used to stop at this function's own re-predictions: a unit
// the user queued AFTERWARDS was predicted against `baseDetail`, which skips
// the retained nulls, so it rendered a trip with the new edit and without the
// retained ones — no prefix of the queue, and so no trip any send produces
// (KI-55, CodeRabbit on PR #73). `enqueue` now carries the same rule, so the
// guarantee holds for the whole queue rather than half of it: unpredicted
// units are a strict suffix of `pending`, and every rendered preview is a
// prefix of the send order.
//
// Note this function relies on that: while `predictable` is true, `acc.pending`
// holds no nulls, so the `enqueue` call below predicts normally. The first
// re-prediction failure flips `predictable` and every later unit is appended
// unpredicted here, without going through `enqueue` at all.
export function confirmHead(state: OptimisticState, outcome: CommandOutcome): OptimisticState {
  const rest = state.pending.slice(1);
  let acc: OptimisticState = { confirmed: outcome, pending: [] };
  let predictable = true;
  for (const unit of rest) {
    if (predictable) {
      const r = enqueue(acc, unit.id, unit.commands);
      if (r.ok) {
        acc = r.state;
        continue;
      }
      predictable = false;
    }
    // Retained with the description the user was already shown (there is no
    // fresh prediction to describe it from) and no predicted detail.
    acc = { ...acc, pending: [...acc.pending, { ...unit, predictedDetail: null }] };
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
