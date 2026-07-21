import type { BatchableCommand, TripDetail, TripEvent } from "@tc/contracts";
import type { Rejection } from "./trip/decide";
import { decideTripCommand } from "./trip/decide";
import { evolveTrip } from "./trip/evolve";
import { tripDetailFromState } from "./trip/detail";
import { describeUserBatch } from "./trip/history";
import { hydrate } from "./trip/hydrate";
import { DEFAULT_CONFLICT_CONTEXT } from "./trip/conflicts";

export type PredictResult =
  | { ok: true; detail: TripDetail; description: string }
  | { ok: false; rejection: Rejection };

// actorId is unused by every batchable command's events (only TripCreated reads
// it, and CreateTrip is not batchable). A stable sentinel keeps decide happy.
const PREDICT_ACTOR = "__optimistic__";

// Predict the outcome of an atomic batch against a detail, reusing the exact
// server decider + reducer. Client-side conflicts use the default context;
// the server response remains authoritative for conflicts on reconcile.
export function predictBatch(detail: TripDetail, commands: BatchableCommand[]): PredictResult {
  const before = hydrate(detail);
  let state = before;
  const events: TripEvent[] = [];
  for (const command of commands) {
    const decision = decideTripCommand(state, command, { actorId: PREDICT_ACTOR });
    if (!decision.ok) return { ok: false, rejection: decision.rejection };
    for (const event of decision.events) state = evolveTrip(state, event);
    events.push(...decision.events);
  }
  return {
    ok: true,
    detail: tripDetailFromState(state, detail.createdAt, DEFAULT_CONFLICT_CONTEXT),
    description: describeUserBatch(before, events),
  };
}

export function predictCommand(detail: TripDetail, command: BatchableCommand): PredictResult {
  return predictBatch(detail, [command]);
}
