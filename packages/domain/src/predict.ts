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
//
// `skipNoOps` predicts what the server's batch endpoint will do with the same
// commands: `decideInOrder` (server/commands.ts) skips a no-op sub-command and
// `executeTripCommandBatch` refuses only a batch with nothing left, as "no-op".
// A stored suggestion is replayed through exactly that on accept, so its
// overlay and its dry run at creation pass it. The optimistic queue does not:
// it refuses the whole unit, as it always has.
export function predictBatch(
  detail: TripDetail,
  commands: BatchableCommand[],
  options: { skipNoOps?: boolean } = {},
): PredictResult {
  const before = hydrate(detail);
  let state = before;
  const events: TripEvent[] = [];
  for (const command of commands) {
    const decision = decideTripCommand(state, command, { actorId: PREDICT_ACTOR });
    if (!decision.ok) {
      if (options.skipNoOps && decision.rejection.code === "no-op") continue;
      return { ok: false, rejection: decision.rejection };
    }
    for (const event of decision.events) state = evolveTrip(state, event);
    events.push(...decision.events);
  }
  if (options.skipNoOps && events.length === 0) {
    return { ok: false, rejection: { code: "no-op", message: "This change would have no effect." } };
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

// M13 link 4. The client's concurrent-edit detector asks "did this stop change
// on the server while I had unsent work naming it?", and the honest comparison
// is the domain's own field-by-field one rather than a structural or JSON
// equality the client would maintain separately.
//
// Re-exported through THIS entrypoint on purpose: the lint wall lets only
// `src/server` and `src/app/api` import `@tc/domain`, and `predict.ts` is the
// curated surface the client is allowed (via `@tc/predict`). A second copy of
// activity equality on the client side would also lose what
// `KI-2026-09-05-o` bought — `FIELD_EQUAL` is a `Record<keyof ActivityState, …>`,
// so a ninth activity field is a compile error there and every caller of this
// starts accounting for it in the same commit.
export { activityStatesEqual } from "./trip/equality";
