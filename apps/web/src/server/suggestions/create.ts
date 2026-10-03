import { randomUUID } from "node:crypto";
import type { CreateSuggestionInput, SuggestionChange, TripDetail } from "@tc/contracts";
import { foldEnvelopes, tripDetailFromState } from "@tc/domain";
import { predictBatch } from "@tc/domain/predict";
import { memberRole } from "../accessPolicy";
import { effectiveMembers } from "../access/members";
import { serverConflictContext } from "../conflictContext";
import { db } from "../db/client";
import { tripSuggestionChanges, tripSuggestions } from "../db/schema";
import { readStream } from "../eventStore";
import { dependsOn } from "./dependencies";
import { refuse, toChange, type SuggestionResult } from "./shared";

/**
 * Store a suggester's draft as one suggestion of N changes, one per unit
 * (spec W1), or refuse it and store nothing.
 *
 * Only a member whose effective role is exactly `suggester` may: an editor
 * writes directly, and a viewer — including a suggester a lapse capped — may
 * not ask at all (spec §2.7).
 *
 * Every unit is dry-run in order with the domain's own `predictBatch`, each on
 * the detail the one before it left (W4). It skips a no-op sub-command and
 * refuses a unit with nothing left, which is what `executeTripCommandBatch`
 * does on accept (W51) — so this is the check the reviewer's accept repeats for
 * real, and a draft that is already broken never reaches a reviewer. The same
 * prediction writes each change's sentence (W2), so the reviewer reads what
 * the history panel will say once it is accepted.
 *
 * One transaction: the stream read, the role, the dry run and the inserts
 * agree on one head, which is the `base_seq` recorded.
 */
export async function createSuggestion(
  tripId: string,
  actorId: string,
  input: CreateSuggestionInput,
  now: string = new Date().toISOString(),
): Promise<SuggestionResult<SuggestionChange[]>> {
  const units = input.units.map((u) => u.commands);
  // Accepting replays a change through `executeTripCommandBatch`, which takes
  // its trip from the commands. A command naming another trip would be run
  // there with the REVIEWER's rights, so it is refused here, before storage.
  if (units.some((commands) => commands.some((c) => c.tripId !== tripId))) {
    return refuse("invalid", "Every command in a suggestion must target this trip.");
  }

  return db.transaction(async (tx): Promise<SuggestionResult<SuggestionChange[]>> => {
    const history = await readStream(tx, tripId);
    const state = foldEnvelopes(history);
    const first = history[0];
    if (state === null || first === undefined) return refuse("not-found", "This trip does not exist.");
    const role = memberRole(actorId, await effectiveMembers(tx, tripId, state.members));
    if (role === null) return refuse("not-found", "This trip does not exist.");
    if (role !== "suggester") return refuse("forbidden", "Only a member who can suggest may send a suggestion.");

    let detail: TripDetail = tripDetailFromState(state, first.occurredAt, serverConflictContext());
    const descriptions: string[] = [];
    for (const [index, commands] of units.entries()) {
      const predicted = predictBatch(detail, commands, { skipNoOps: true });
      if (!predicted.ok) {
        return {
          ok: false,
          error: { code: "does-not-apply", index, message: predicted.rejection.message },
        };
      }
      detail = predicted.detail;
      descriptions.push(predicted.description);
    }

    const suggestion = {
      id: randomUUID(),
      tripId,
      authorId: actorId,
      note: input.note ?? null,
      baseSeq: history.length,
      createdAt: new Date(now),
    };
    const ids = units.map(() => randomUUID());
    const rows = dependsOn(units).map((deps, position) => ({
      id: ids[position]!,
      suggestionId: suggestion.id,
      tripId,
      position,
      commands: units[position]!,
      description: descriptions[position]!,
      dependsOn: deps.map((j) => ids[j]!),
      status: "pending",
      createdAt: suggestion.createdAt,
      resolvedBy: null,
      resolvedAt: null,
    }));
    await tx.insert(tripSuggestions).values(suggestion);
    await tx.insert(tripSuggestionChanges).values(rows);
    return { ok: true, value: rows.map((row) => toChange(row, suggestion)) };
  });
}
