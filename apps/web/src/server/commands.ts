import { z } from "zod";
import {
  BatchableCommand,
  CreateTrip,
  TripCommand,
  travellerIds,
  type EventEnvelope,
  type Origin,
  type TripDetail,
  type TripEvent,
  type TripHistory,
  type TripMember,
} from "@tc/contracts";
import {
  buildHistoryEntries,
  decideHistoryCommand,
  decideTripCommand,
  deriveUndoRedo,
  evolveTrip,
  foldEnvelopes,
  groupBatches,
  tripDetailFromState,
  type DecideContext,
} from "@tc/domain";
import { serverConflictContext } from "./conflictContext";
import { db } from "./db/client";
import { appendToStream, readStream, readStreamHeadSeq } from "./eventStore";
import { appliedKeys, recordReceipts } from "./commandReceipts";
import { applyTripEvents, upsertTripDetail } from "./projections";
import { memberRolePolicy } from "./accessPolicy";
import { effectiveMembers } from "./access/members";
import { overlayMembers } from "./access/overlay";

export type CommandResult =
  | { ok: true; tripId: string; detail: TripDetail; history: TripHistory }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        /** The stream's head, when a caller-supplied `expectedSeq` was stale. */
        currentSeq?: number;
      };
    };

// Build the authoritative detail (persisting it) and history DTO from the
// full envelope list — the same shapes the read endpoints serve. Runs inside
// the caller's transaction so the projections it writes are part of the same
// atomic write as the appended events.
async function projectAndHistory(
  tx: Parameters<typeof upsertTripDetail>[0],
  allEnvelopes: EventEnvelope[],
  tripId: string,
): Promise<{ detail: TripDetail; history: TripHistory }> {
  const outcome = outcomeOf(allEnvelopes, tripId);
  await upsertTripDetail(tx, outcome.detail);
  return outcome;
}

// The detail and history DTOs for a stream, written nowhere. `projectAndHistory`
// persists the detail too. A unit whose receipt says it is already applied
// (ADR-066) is answered with this, the trip exactly as it stands.
function outcomeOf(allEnvelopes: EventEnvelope[], tripId: string): { detail: TripDetail; history: TripHistory } {
  const nextState = foldEnvelopes(allEnvelopes);
  if (nextState === null) throw new Error("state cannot be null after an accepted command");
  const firstEnvelope = allEnvelopes[0];
  if (firstEnvelope === undefined) throw new Error("no envelopes to project");
  const detail = tripDetailFromState(nextState, firstEnvelope.occurredAt, serverConflictContext());
  const targets = deriveUndoRedo(groupBatches(allEnvelopes));
  const history: TripHistory = {
    tripId,
    entries: buildHistoryEntries(allEnvelopes).reverse(),
    canUndo: targets.undo !== null,
    canRedo: targets.redo !== null,
  };
  return { detail, history };
}

// The answer to a unit that is already applied: success, with the trip as it
// stands. Not `no-op`. The unit did have an effect, once, and the sender
// confirms it the same way it confirms any applied unit.
function alreadyApplied(tripId: string, history: EventEnvelope[], members: TripMember[] | null): CommandResult {
  const { detail, history: historyDto } = outcomeOf(history, tripId);
  return { ok: true, tripId, detail: withMembers(detail, members), history: historyDto };
}

const CONFLICT: CommandFailure = {
  ok: false,
  error: { code: "concurrency-conflict", message: "Someone else changed this trip. Retry." },
};

// The command pipeline (docs/guidelines/building-the-parts.md). Every write
// in the planning domain goes through this exact sequence — including undo,
// redo, and revert, which differ ONLY in how step 4 decides (ADR-005).
//
// `options.idempotencyKey` is the id the client minted for the unit this
// command is (ADR-066). A key already on the trip's receipts is answered with
// the trip as it stands, and nothing is decided or appended. Otherwise the
// receipt commits with the command's events, or with its `no-op`, which is as
// much a decision as an append and must not be made again later against a
// trip that has moved.
//
// The receipts are read BEFORE the stream. A receipt committed before that read
// is then seen together with the events it committed with. Read after the
// stream, a flush committing between the two reads would be seen as "applied"
// and answered with a trip that did not yet hold it.
//
// A keyed command that fails may have failed because its own unit landed first,
// carried by the page's unload flush (KI-5): it lost the append race, or the
// flush's events made it a rejection (an AddDay of a day that now exists). So
// its receipt is looked up once more. On a hit the answer is the trip; on a
// miss the original failure stands. It is never decided again: a re-decided
// head could land after units the user made later.
export async function executeTripCommand(
  input: unknown,
  actorId: string,
  options: { idempotencyKey?: string } = {},
): Promise<CommandResult> {
  // 1. validate the command against the contract
  const parsed = TripCommand.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "invalid-command", message: parsed.error.message } };
  }
  const command = parsed.data;
  const key = options.idempotencyKey;

  const result = await db.transaction(async (tx): Promise<CommandResult> => {
    // 2a. a unit already applied is answered, not decided again (ADR-066).
    //     Read first, acted on only once the actor is authorized.
    const applied = key !== undefined && (await appliedKeys(tx, command.tripId, [key])).has(key);

    // 2-3. load, fold, authorize
    const loaded = await loadAndAuthorize(tx, command.tripId, actorId, [command.type]);
    if (!loaded.ok) return loaded;
    const { history, state, members } = loaded;
    if (applied && history.length > 0) return alreadyApplied(command.tripId, history, members);

    // 4. decide — history commands need the envelope history (already loaded;
    //    zero extra I/O), everything else the folded state.
    let events: TripEvent[];
    let origin: Origin;
    if (
      command.type === "UndoLastChange" ||
      command.type === "RedoChange" ||
      command.type === "RevertToState"
    ) {
      const decision = decideHistoryCommand(history, command);
      if (!decision.ok) return { ok: false, error: decision.rejection };
      events = decision.events;
      origin = decision.origin;
    } else {
      const decision = decideTripCommand(state, command, decideContext(actorId, members));
      if (!decision.ok) {
        // A keyed no-op is recorded like an applied unit: a resend is answered
        // from the receipt, not decided against whatever the trip is by then.
        if (decision.rejection.code === "no-op" && key !== undefined) await recordOrRollBack(tx, command.tripId, [key]);
        return { ok: false, error: decision.rejection };
      }
      events = decision.events;
      origin = { kind: "user" };
    }

    // 5-7. append (one batch per command execution) and project — a revert
    //    into a formerly-conflicted state resurfaces its badges here.
    const projected = await appendAndProject(tx, { tripId: command.tripId, history, events, actorId, origin });
    if (!projected.ok) return projected;
    // 7b. the receipt, in the same transaction. Losing it means another request
    //     carrying this unit committed first: roll this one back.
    if (key !== undefined) await recordOrRollBack(tx, command.tripId, [key]);

    return {
      ok: true,
      tripId: command.tripId,
      detail: withMembers(projected.detail, members),
      history: projected.history,
    };
  }).catch((error: unknown) => {
    if (error instanceof RolledBack) return error.failure;
    throw error;
  });

  if (key === undefined || result.ok || !mayHaveLandedElsewhere(result.error.code)) return result;
  // Failed, keyed: did this unit land through another request? One indexed
  // lookup; the trip is read only on a hit.
  if (!(await appliedKeys(db, command.tripId, [key])).has(key)) return result;
  return db.transaction(async (tx): Promise<CommandResult> => {
    const loaded = await loadAndAuthorize(tx, command.tripId, actorId, [command.type]);
    if (!loaded.ok) return loaded;
    return alreadyApplied(command.tripId, loaded.history, loaded.members);
  });
}

// Failures a unit's own landing elsewhere can cause: a lost race, or a domain
// rejection of the unit decided on top of itself. Not a malformed request, a
// refused actor, or a no-op, which already answered this unit.
function mayHaveLandedElsewhere(code: string): boolean {
  return code !== "invalid-command" && code !== "forbidden" && code !== "no-op";
}

// Step 7b: record the receipts, or roll the whole transaction back when another
// request recorded one of them first (Postgres has aborted it at the insert).
async function recordOrRollBack(tx: Tx, tripId: string, keys: readonly string[]): Promise<void> {
  if (!(await recordReceipts(tx, tripId, keys))) throw new RolledBack(CONFLICT);
}

type Tx = Parameters<typeof upsertTripDetail>[0];
type CommandFailure = Extract<CommandResult, { ok: false }>;

// Steps 2-3 of the pipeline, shared by both entry points: load the stream, fold
// it, and authorize EVERY command type the call will decide. Roles are
// per-command (accessPolicy.ts), so a batch that checked only its first command
// could smuggle in one the actor's role does not permit.
//
// The member list is the EFFECTIVE one — the log's owner merged with the
// Access module's accepted-invite rows (M11 link 3). The planning domain still
// knows nothing about invites: `state.members` is unchanged, and the merge
// happens out here, on the way into the seam that was always the only
// interpreter of a role (AGENTS.md invariant 6c).
async function loadAndAuthorize(
  tx: Tx,
  tripId: string,
  actorId: string,
  commandTypes: readonly TripCommand["type"][],
): Promise<
  | { ok: true; history: EventEnvelope[]; state: ReturnType<typeof foldEnvelopes>; members: TripMember[] | null }
  | CommandFailure
> {
  const history = await readStream(tx, tripId);
  const state = foldEnvelopes(history);
  const members = state === null ? null : await effectiveMembers(tx, tripId, state.members);
  if (commandTypes.some((type) => !memberRolePolicy.canExecute(actorId, type, members))) {
    return { ok: false, error: { code: "forbidden", message: "Not a member of this trip." } };
  }
  return { ok: true, history, state, members };
}

// Steps 5-7, shared by both entry points: append under ONE batchId with
// optimistic concurrency against the head this transaction read, then update
// the projections and build the authoritative detail and history (invariant 1).
// The two callers differ only in `origin` — a history command carries its own.
async function appendAndProject(
  tx: Tx,
  { tripId, history, events, actorId, origin }: {
    tripId: string;
    history: EventEnvelope[];
    events: TripEvent[];
    actorId: string;
    origin: Origin;
  },
): Promise<{ ok: true; detail: TripDetail; history: TripHistory } | CommandFailure> {
  const appended = await appendToStream(tx, {
    streamId: tripId,
    expectedSeq: history.length,
    events,
    actorId,
    occurredAt: new Date().toISOString(),
    batchId: crypto.randomUUID(),
    origin,
  });
  if (!appended.ok) {
    return {
      ok: false,
      error: { code: "concurrency-conflict", message: "Someone else changed this trip. Retry." },
    };
  }
  await applyTripEvents(tx, appended.envelopes);
  const { detail, history: historyDto } = await projectAndHistory(tx, [...history, ...appended.envelopes], tripId);
  return { ok: true, detail, history: historyDto };
}

// The stored projection stays exactly what the log produces (invariant 2 —
// `upsertTripDetail` above already wrote it); only the DTO handed back to the
// caller carries the effective member list, so a command response and a
// subsequent GET agree about who is on the trip — and, since a price is per
// person (ADR-060), about what it costs.
//
// `members` is null only for CreateTrip, whose stream did not exist when the
// merge was attempted; the created trip's own projection already carries its
// owner and there are no grants to merge yet.
function withMembers(detail: TripDetail, members: TripMember[] | null): TripDetail {
  return members === null ? detail : overlayMembers(detail, members);
}

// The decider judges conflicts for the traveller count the reader is shown, so
// a dismissal is decided against the same over-budget conflict `withMembers`
// hands back (ADR-060, PR #289 review). `members` is null only before the
// stream exists, where there is nothing to recost.
function decideContext(actorId: string, members: TripMember[] | null): DecideContext {
  return members === null ? { actorId } : { actorId, travellerCount: travellerIds(members).length };
}

const BatchBody = z.array(BatchableCommand).min(1);

// Same pipeline as executeTripCommand, but decides N batchable commands
// against the evolving state and — only if every one succeeds — appends all
// resulting events under ONE batchId, so groupBatches/buildHistoryEntries
// treat the whole batch as a single history entry (ADR-005-adjacent: undo
// unwinds the batch as a unit). Any rejection appends nothing.
//
// `alsoInSameTransaction` is a seam for a NON-PLANNING write that has to be the
// same fact as the batch — today, exactly two callers: `insertSavedDay` writing
// the adds ledger row and its denormalised counter (M11b link 4), and accepting
// a suggestion marking its change row accepted (`suggestions/resolve.ts`,
// ADR-064), whose conditional update throws when another accept got there
// first, so a double accept appends one batch, not two. It runs after
// the events are appended and the projections written, still inside the
// pipeline's transaction, and only when the batch succeeded — or, with
// `options.runOnNoOp`, also when it is a no-op throughout (below). Throwing out
// of it rolls the whole transaction back with it.
//
// It is a hook rather than a call after `executeTripCommandBatch` returns
// because the alternative is two transactions and therefore a window: a ledger
// row against a batch that then lost its optimistic-concurrency check is an add
// of a day that is not in the trip, and a committed batch whose ledger write
// failed is an add nobody is credited for. `SPEC.md` §15 is explicit that the
// leaderboard's credibility is exactly this count being right.
//
// It is NOT a general "run anything here" extension point. It may not append
// events, write a planning projection, or decide a command — invariant 1 says
// planning state is only ever written by the sequence above it. Both callers
// write only their own module's row, append nothing and decide nothing — the
// shape this allows (ADR-064 re-read it for the second). A caller wanting
// anything more is a signal the seam is wrong, not an invitation to widen it.
//
// `options.origin` is who the batch says asked for it; absent, `{ kind: "user" }`.
// Only accepting a suggestion passes one: the reviewer is still `actorId`, and
// the origin names the suggester (ADR-064 decision 3).
//
// `options.expectedSeq` is a CALLER's precondition on the same check step 5
// already makes (ADR-050, Pass B): "only if the trip still stands at revision
// N". It is compared against the stream this transaction read, and the append
// then insists on that same head — so a stale caller is refused and a race
// after the read still loses at the unique index, with no window between. Absent,
// the batch decides against whatever it read — and if another write to the same
// stream commits between that read and this append, the whole transaction is
// run again (see BATCH_APPEND_ATTEMPTS), because a batch with no precondition
// asked for nothing more than "on top of whatever is there when you get to it".
//
// `options.runOnNoOp` runs the same hook for a batch that is a no-op
// throughout: the answer is still `no-op` and nothing is appended, but the hook
// commits with the decision that said so, and is handed the trip as it stands.
// One seam, not two (review of #308): its one user is accepting a suggestion
// the trip already reflects (spec W52, W55), and the limits above bind it
// unchanged. With no append there is no unique index to lose at, so the head is
// read again after the hook, and a stream that moved since the decision is a
// lost race like an append's — rolled back and run again against the new head.
// A write committing after that re-read is ordered after this one; a write
// committing before it is seen.
export async function executeTripCommandBatch(
  input: unknown,
  actorId: string,
  alsoInSameTransaction?: (
    tx: Parameters<typeof upsertTripDetail>[0],
    committed: { tripId: string; detail: TripDetail },
  ) => Promise<void>,
  options: {
    expectedSeq?: number;
    origin?: Origin;
    runOnNoOp?: boolean;
    units?: readonly { key: string; size: number }[];
  } = {},
): Promise<CommandResult> {
  const origin: Origin = options.origin ?? { kind: "user" };
  // 1. validate the batch shape against the contract
  const parsed = BatchBody.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "invalid-command", message: parsed.error.message } };
  }
  const commands = parsed.data;
  const tripId = commands[0]!.tripId;
  if (!commands.every((c) => c.tripId === tripId)) {
    return {
      ok: false,
      error: { code: "invalid-command", message: "All commands in a batch must target the same trip." },
    };
  }
  const units = options.units;
  if (units !== undefined) {
    const sizes = units.reduce((sum, u) => sum + u.size, 0);
    if (units.some((u) => u.size < 1) || sizes !== commands.length || new Set(units.map((u) => u.key)).size !== units.length) {
      return {
        ok: false,
        error: { code: "invalid-command", message: "Units must partition the batch's commands and have distinct keys." },
      };
    }
  }

  // One attempt is one transaction. `lostAppendRace` marks the only failure a
  // fresh attempt can change: step 5's append losing `events_stream_seq` to a
  // write that committed after step 2's read. Nothing of that attempt survives:
  // Postgres aborts the transaction at the failed insert, and step 8's hook has
  // not run yet — so a re-run starts from nothing. The no-op hook's lost race
  // has run its hook, so it throws to take that write back with it.
  const attempt = async () => {
    let lostAppendRace = false;
    const result = await db.transaction(async (tx): Promise<CommandResult> => {
      // 2a. keyed units already applied (ADR-066), read BEFORE the stream for the
      //     reason `executeTripCommand` gives, acted on only after authorization.
      const applied = units === undefined ? new Set<string>() : await appliedKeys(tx, tripId, units.map((u) => u.key));

      // 2-3. load, fold, authorize — for EVERY sub-command (see loadAndAuthorize)
      const loaded = await loadAndAuthorize(tx, tripId, actorId, commands.map((c) => c.type));
      if (!loaded.ok) return loaded;
      const { history, members } = loaded;

      // 3b. the caller's precondition, after authorization so a non-member learns
      //     nothing about the trip's revision.
      if (options.expectedSeq !== undefined && options.expectedSeq !== history.length) {
        return {
          ok: false,
          error: {
            code: "concurrency-conflict",
            message: `This trip has changed since revision ${options.expectedSeq}; it is at ${history.length}. Re-read it and retry.`,
            currentSeq: history.length,
          },
        };
      }

      // 4. decide. Keyed units (ADR-066) unit by unit, see `decideUnits`; plain
      //    commands in order, all or nothing.
      let events: TripEvent[];
      let keysToRecord: string[] = [];
      if (units !== undefined) {
        const keyed = decideUnits(loaded.state, commands, units, applied, decideContext(actorId, members));
        if (!keyed.ok) return keyed;
        if (keyed.decidedKeys.length === 0) return alreadyApplied(tripId, history, members);
        events = keyed.events;
        keysToRecord = keyed.decidedKeys;
      } else {
        const decided = decideInOrder(loaded.state, commands, decideContext(actorId, members));
        if (!decided.ok) return decided;
        events = decided.events;
      }
      // If every sub-command was a no-op there is nothing to append — report it the
      // same way a single no-op command does, rather than appending an empty batch
      // (appendToStream requires ≥1 event and one batch = one history entry).
      if (events.length === 0) {
        // Keyed no-op units are decided too, so they get receipts (see
        // `executeTripCommand`).
        if (!(await recordReceipts(tx, tripId, keysToRecord))) {
          lostAppendRace = true;
          throw new RolledBack(CONFLICT);
        }
        if (alsoInSameTransaction && options.runOnNoOp) {
          // Authorized and decided, so the stream exists: nothing is null here.
          const unchanged = tripDetailFromState(loaded.state!, history[0]!.occurredAt, serverConflictContext());
          await alsoInSameTransaction(tx, { tripId, detail: withMembers(unchanged, members) });
          if ((await readStreamHeadSeq(tx, tripId)) !== history.length) {
            lostAppendRace = true;
            throw new RolledBack({
              ok: false,
              error: { code: "concurrency-conflict", message: "Someone else changed this trip. Retry." },
            });
          }
        }
        return { ok: false, error: { code: "no-op", message: "This change would have no effect." } };
      }

      // 5-7. append every event from every command under ONE batchId, and project
      const projected = await appendAndProject(tx, { tripId, history, events, actorId, origin });
      if (!projected.ok) {
        lostAppendRace = true;
        return projected;
      }
      // 7b. the receipts, with the events. One lost means a request carrying
      //     that unit committed first: a lost race like the append's, so this
      //     attempt is rolled back and the batch run again, and the re-run
      //     leaves that unit out.
      if (!(await recordReceipts(tx, tripId, keysToRecord))) {
        lostAppendRace = true;
        throw new RolledBack(CONFLICT);
      }

      // 8. the non-planning write that has to commit with this batch, if any.
      //    Last, so it sees the trip exactly as this batch left it.
      const answer = withMembers(projected.detail, members);
      if (alsoInSameTransaction) await alsoInSameTransaction(tx, { tripId, detail: answer });

      return { ok: true, tripId, detail: answer, history: projected.history };
    }).catch((error: unknown) => {
      if (error instanceof RolledBack) return error.failure;
      throw error;
    });
    return { result, lostAppendRace };
  };

  // A lost append race is re-run only when the caller named no revision. With an
  // `expectedSeq` the refusal IS the answer the caller asked for (ADR-050).
  for (let tries = 1; ; tries++) {
    const { result, lostAppendRace } = await attempt();
    if (!lostAppendRace || options.expectedSeq !== undefined || tries >= BATCH_APPEND_ATTEMPTS) return result;
  }
}

// Step 4 for keyed units (ADR-066), in their order. A unit already applied is
// left out. A unit the domain refuses is left out too, and the units after it
// are still decided, against the state the units before it left. This is the
// in-app drain's rule (KI-5 residual 8), and it is what keeps the unload flush
// from losing everything behind a unit in flight that the server is refusing.
// A unit is atomic within itself: one refused command refuses its whole unit.
// `decidedKeys` lists the units decided, no-ops included, and is what gets
// receipts. With none decided and one refused, the answer is that refusal.
function decideUnits(
  initial: ReturnType<typeof foldEnvelopes>,
  commands: readonly BatchableCommand[],
  units: readonly { key: string; size: number }[],
  applied: ReadonlySet<string>,
  ctx: DecideContext,
): { ok: true; events: TripEvent[]; decidedKeys: string[] } | CommandFailure {
  let state = initial;
  const events: TripEvent[] = [];
  const decidedKeys: string[] = [];
  let firstRefusal: CommandFailure | null = null;
  let at = 0;
  for (const unit of units) {
    const unitCommands = commands.slice(at, at + unit.size);
    at += unit.size;
    if (applied.has(unit.key)) continue;
    const decided = decideInOrder(state, unitCommands, ctx);
    if (!decided.ok) {
      firstRefusal ??= decided;
      continue;
    }
    for (const event of decided.events) state = evolveTrip(state, event);
    events.push(...decided.events);
    decidedKeys.push(unit.key);
  }
  if (decidedKeys.length === 0 && firstRefusal) return firstRefusal;
  return { ok: true, events, decidedKeys };
}

// Step 4 for a list of batchable commands, shared by the batch and by a
// creation's follow-up: decide each in order against the state the ones before
// it left. A no-op sub-command is SKIPPED, not fatal — one redundant Set*/etc.
// must not roll back an otherwise-valid batch (2026-07-25 live-testing
// finding). Real rejections (day-not-found, activity-already-exists, …) abort.
function decideInOrder(
  initial: ReturnType<typeof foldEnvelopes>,
  commands: readonly BatchableCommand[],
  ctx: DecideContext,
): { ok: true; events: TripEvent[] } | CommandFailure {
  let state = initial;
  const events: TripEvent[] = [];
  for (const command of commands) {
    const decision = decideTripCommand(state, command, ctx);
    if (!decision.ok) {
      if (decision.rejection.code === "no-op") continue;
      return { ok: false, error: decision.rejection };
    }
    for (const event of decision.events) state = evolveTrip(state, event);
    events.push(...decision.events);
  }
  return { ok: true, events };
}

// A failure raised INSIDE a transaction that has already written, so that
// throwing it rolls those writes back. Returning a failure from a
// `db.transaction` callback commits whatever came before it — harmless for the
// two entry points above, which refuse before their only append (bar the batch's
// no-op hook losing its race), and exactly the window `executeTripCreation`
// exists to close.
class RolledBack extends Error {
  readonly failure: CommandFailure;
  constructor(failure: CommandFailure) {
    super(failure.error.message);
    this.failure = failure;
  }
}

// **A trip's genesis and the commands that follow it, as ONE transaction**
// (KI-2026-09-19-b, KI-2026-09-19-f). For a caller that creates a trip and fills
// it in the same request — `POST /v1/trips/import`, `POST /v1/trips` with dates
// — so a failure anywhere after `CreateTrip` rolls the trip back with it instead
// of leaving it for a compensating `DeleteTrip` that can itself fail.
//
// It is the pipeline run twice inside one transaction, not a third way to
// write: steps 2-7 for `CreateTrip` exactly as `executeTripCommand` runs them,
// then steps 2-7 for the follow-up exactly as `executeTripCommandBatch` does,
// against the stream the first half just wrote (invariant 1 holds for each
// half). Two appends, so two batches and two history entries — the same history
// the two separate writes used to produce, and the reason undo on a fresh
// import still unwinds the import and not the trip's creation.
//
// `CreateTrip` stays out of `BatchableCommand` on purpose: genesis mints the
// trip's id and its owner, and that union is also the assistant's command
// vocabulary. This takes the genesis as its own argument instead.
//
// There is no retry loop like the batch's: the trip id is minted by the caller
// for this request, so nothing else can be writing to its stream.
/**
 * Create a trip and apply `then` (batchable commands on that same trip) in one
 * transaction. Returns the trip as the follow-up left it, or a refusal after
 * which no trip exists at all. `then` may be empty.
 */
export async function executeTripCreation(
  create: unknown,
  then: unknown,
  actorId: string,
): Promise<CommandResult> {
  // 1. validate both halves against the contract
  const parsedCreate = CreateTrip.safeParse(create);
  if (!parsedCreate.success) {
    return { ok: false, error: { code: "invalid-command", message: parsedCreate.error.message } };
  }
  const parsedThen = z.array(BatchableCommand).safeParse(then);
  if (!parsedThen.success) {
    return { ok: false, error: { code: "invalid-command", message: parsedThen.error.message } };
  }
  const genesis = parsedCreate.data;
  const commands = parsedThen.data;
  const tripId = genesis.tripId;
  if (!commands.every((c) => c.tripId === tripId)) {
    return {
      ok: false,
      error: { code: "invalid-command", message: "Every command must target the trip being created." },
    };
  }

  const refuse = (failure: CommandFailure): never => {
    throw new RolledBack(failure);
  };

  try {
    return await db.transaction(async (tx): Promise<CommandResult> => {
      // 2-7 for the genesis — CreateTrip is decided against the empty stream,
      // and appendAndProject writes the summary row and the owner.
      const empty = await loadAndAuthorize(tx, tripId, actorId, ["CreateTrip"]);
      if (!empty.ok) return refuse(empty);
      const created = decideTripCommand(empty.state, genesis, { actorId });
      if (!created.ok) return refuse({ ok: false, error: created.rejection });
      const born = await appendAndProject(tx, {
        tripId,
        history: empty.history,
        events: created.events,
        actorId,
        origin: { kind: "user" },
      });
      if (!born.ok) return refuse(born);

      // 2-7 for the follow-up, authorized against the trip as it now stands —
      // its creator is its owner. Every follow-up refusal from here on throws,
      // so the genesis above goes with it.
      const loaded = await loadAndAuthorize(tx, tripId, actorId, commands.map((c) => c.type));
      if (!loaded.ok) return refuse(loaded);
      const decided = decideInOrder(loaded.state, commands, decideContext(actorId, loaded.members));
      if (!decided.ok) return refuse(decided);
      // Nothing to follow with (none sent, or every one a no-op): the trip as
      // created is the whole answer.
      if (decided.events.length === 0) {
        return { ok: true, tripId, detail: withMembers(born.detail, loaded.members), history: born.history };
      }
      const filled = await appendAndProject(tx, {
        tripId,
        history: loaded.history,
        events: decided.events,
        actorId,
        origin: { kind: "user" },
      });
      if (!filled.ok) return refuse(filled);
      return { ok: true, tripId, detail: withMembers(filled.detail, loaded.members), history: filled.history };
    });
  } catch (error) {
    if (error instanceof RolledBack) return error.failure;
    throw error;
  }
}

// How many times a batch with no precondition is run before a lost append race
// is reported as `concurrency-conflict` (KI-5 residual race #1: a page's unload
// flush reaching the server while the command ahead of it is still committing).
// A re-run is the batch arriving a moment later: it re-reads, re-folds and
// re-decides against the write it lost to, so a sub-command that no longer makes
// sense is refused by the domain exactly as it would have been had it arrived
// second. Bounded so a stream under sustained contention answers its caller
// instead of holding the request open.
const BATCH_APPEND_ATTEMPTS = 3;
