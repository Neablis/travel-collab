import { randomUUID } from "node:crypto";
import { and, count, eq, isNull } from "drizzle-orm";
import type { CreateSuggestionInput, SuggestionChange, SuggestionVia, TripDetail } from "@tc/contracts";
import { foldEnvelopes, tripDetailFromState } from "@tc/domain";
import { predictBatch } from "@tc/domain/predict";
import { memberRole, roleAtLeast } from "../accessPolicy";
import { effectiveMembers } from "../access/members";
import { serverConflictContext } from "../conflictContext";
import { db } from "../db/client";
import { tripSuggestionChanges, tripSuggestions } from "../db/schema";
import { readStream } from "../eventStore";
import { dependsOn, effectOf, type UnitEffect } from "./dependencies";
import {
  expireStale,
  openAt,
  refuse,
  SUGGESTION_AUTHOR_PENDING_MAX,
  SUGGESTION_TRIP_PENDING_MAX,
  toChanges,
  type SuggestionResult,
} from "./shared";

/**
 * Store a draft as one suggestion of N changes, one per unit (spec W1), or
 * refuse it and store nothing.
 *
 * A member whose effective role is at least `suggester` may: since ADR-067
 * decision 1 an editor or the owner may suggest too, which is how their
 * assistant puts a multi-change turn on the board. A viewer — including a
 * suggester or an editor a lapse capped — may not ask at all (spec §2.7).
 *
 * `via: "assistant"` marks a suggestion an assistant turn stored for its
 * author (decision 2). It is exempt from the per-author cap, and not counted
 * toward it, but held to the trip's cap like any other (decision 3).
 *
 * Every unit is dry-run in order with the domain's own `predictBatch`, each on
 * the detail the one before it left (W4). It skips a no-op sub-command and
 * refuses a unit with nothing left, which is what `executeTripCommandBatch`
 * does on accept (W51) — so this is the check the reviewer's accept repeats for
 * real, and a draft that is already broken never reaches a reviewer. The same
 * prediction writes each change's sentence (W2), so the reviewer reads what
 * the history panel will say once it is accepted. And the events it decided are
 * what each change is recorded as creating, for its dependencies (W56).
 *
 * One transaction: the stream read, the role, the dry run and the inserts
 * agree on one head, which is the `base_seq` recorded.
 */
export async function createSuggestion(
  tripId: string,
  actorId: string,
  input: CreateSuggestionInput,
  now: string = new Date().toISOString(),
  { via }: { via?: SuggestionVia } = {},
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
    if (!roleAtLeast(role, "suggester")) return refuse("forbidden", "Only a member who can suggest may send a suggestion.");

    // Before the dry run, which is the expensive part (KI-20261003-e). Aged-out
    // changes are recorded expired first, in this transaction, so the count
    // and the table agree.
    await expireStale(tx, tripId, new Date(now));
    const open = await tx
      .select({ authorId: tripSuggestions.authorId, byHand: isNull(tripSuggestions.via), n: count() })
      .from(tripSuggestionChanges)
      .innerJoin(tripSuggestions, eq(tripSuggestions.id, tripSuggestionChanges.suggestionId))
      .where(and(eq(tripSuggestionChanges.tripId, tripId), openAt(new Date(now))))
      .groupBy(tripSuggestions.authorId, isNull(tripSuggestions.via));
    // The author cap counts what the author drafted by hand: an assistant turn
    // is one request, however many changes it holds (ADR-067 decision 3).
    const own = open.find((o) => o.authorId === actorId && o.byHand)?.n ?? 0;
    const onTrip = open.reduce((sum, o) => sum + o.n, 0);
    if (via === undefined && own + units.length > SUGGESTION_AUTHOR_PENDING_MAX) {
      return refuse(
        "too-many-pending",
        `You can have up to ${SUGGESTION_AUTHOR_PENDING_MAX} suggested changes waiting on this trip; ${own} are. Withdraw some, or wait for a decision.`,
      );
    }
    if (onTrip + units.length > SUGGESTION_TRIP_PENDING_MAX) {
      return refuse(
        "too-many-pending",
        `This trip already has ${onTrip} suggested changes waiting, and holds up to ${SUGGESTION_TRIP_PENDING_MAX}. Wait for a decision.`,
      );
    }

    let detail: TripDetail = tripDetailFromState(state, first.occurredAt, serverConflictContext());
    const descriptions: string[] = [];
    const effects: UnitEffect[] = [];
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
      effects.push(effectOf(predicted.events));
    }

    const suggestion = {
      id: randomUUID(),
      tripId,
      authorId: actorId,
      note: input.note ?? null,
      baseSeq: history.length,
      createdAt: new Date(now),
      via: via ?? null,
    };
    const ids = units.map(() => randomUUID());
    const rows = dependsOn(units.map((commands, i) => ({ commands, effect: effects[i]! }))).map((deps, position) => ({
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
    return { ok: true, value: toChanges(rows, suggestion) };
  });
}
