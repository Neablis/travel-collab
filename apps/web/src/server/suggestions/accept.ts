import { and, eq, inArray } from "drizzle-orm";
import { BatchableCommand, type Origin, type SuggestionChange, type TripDetail } from "@tc/contracts";
import { predictBatch } from "@tc/domain/predict";
import { roleAtLeast } from "../accessPolicy";
import { executeTripCommandBatch } from "../commands";
import { db } from "../db/client";
import { tripSuggestionChanges, tripSuggestions } from "../db/schema";
import { getTripDetail } from "../projections";
import { SuggestionAlreadyResolved } from "./resolve";
import {
  expireStale,
  isExpired,
  refuse,
  roleOn,
  SUGGESTION_TTL_DAYS,
  toChange,
  type ChangeRow,
  type SuggestionError,
  type SuggestionErrorCode,
  type SuggestionResult,
  type SuggestionRow,
} from "./shared";

type Row = { change: ChangeRow; suggestion: SuggestionRow };

/** A refusal about one change of the set, which it names by id and in words. */
function refuseFor(code: SuggestionErrorCode, row: Row | string, why: string): { ok: false; error: SuggestionError } {
  const changeId = typeof row === "string" ? row : row.change.id;
  const named = typeof row === "string" ? "A change" : `“${row.change.description}”`;
  return { ok: false, error: { code, changeId, message: `${named} ${why} Nothing was accepted.` } };
}

/**
 * Accept several pending changes as ONE batch (M40 D1): one `batchId`, so one
 * History entry and one undo, with `Origin` `suggestions` naming every change
 * and every author (D3). All or nothing: any refusal lands nothing and names
 * the change it is about.
 *
 * A single accept's rules (`resolve.ts`), for the set: at least `editor`;
 * every change on this trip, pending and unexpired; and every pending parent
 * in the set too, since a parent left out would land after its child.
 * Replayed in creation order, which puts parents first: a change depends only
 * on earlier changes of its own suggestion (spec W9). A set the trip already
 * reflects throughout is accepted with nothing appended (W52, W55).
 *
 * Undo is the ordinary undo of that batch, and leaves the rows `accepted` (D2).
 */
export async function acceptSuggestionChanges(
  tripId: string,
  changeIds: readonly string[],
  reviewerId: string,
  now: string = new Date().toISOString(),
): Promise<SuggestionResult<SuggestionChange[]>> {
  const access = await roleOn(tripId, reviewerId);
  if (!access.ok) return access;
  if (!roleAtLeast(access.value, "editor")) return refuse("forbidden", "Only an editor can review a suggestion.");

  const ids = [...new Set(changeIds)];
  const found: Row[] = await db
    .select({ change: tripSuggestionChanges, suggestion: tripSuggestions })
    .from(tripSuggestionChanges)
    .innerJoin(tripSuggestions, eq(tripSuggestions.id, tripSuggestionChanges.suggestionId))
    .where(and(inArray(tripSuggestionChanges.id, ids), eq(tripSuggestionChanges.tripId, tripId)));
  const byId = new Map(found.map((r) => [r.change.id, r]));
  const missing = ids.find((id) => !byId.has(id));
  if (missing !== undefined) return refuseFor("not-found", missing, "does not exist.");
  const expired = found.find((r) => isExpired(r.change, new Date(now)));
  if (expired !== undefined) {
    // Refusing is the write that records it, as on a single accept.
    if (expired.change.status === "pending") await expireStale(db, tripId, new Date(now));
    return refuseFor("expired", expired, `expired: nobody decided it within ${SUGGESTION_TTL_DAYS} days.`);
  }
  const resolved = found.find((r) => r.change.status !== "pending");
  if (resolved !== undefined) return refuseFor("already-resolved", resolved, "was already resolved.");

  // A parent outside the set must already be accepted. A dismissed one took
  // its children with it, so any other status here is pending.
  const outside = [...new Set(found.flatMap((r) => r.change.dependsOn))].filter((id) => !byId.has(id));
  if (outside.length > 0) {
    const parents = await db
      .select({ id: tripSuggestionChanges.id, status: tripSuggestionChanges.status })
      .from(tripSuggestionChanges)
      .where(inArray(tripSuggestionChanges.id, outside));
    const waiting = new Set(parents.filter((p) => p.status !== "accepted").map((p) => p.id));
    const blocked = found.find((r) => r.change.dependsOn.some((id) => waiting.has(id)));
    if (blocked !== undefined) {
      return refuseFor("dependency-pending", blocked, "builds on a change that is still pending; accept that one with it.");
    }
  }

  // `commands` is stored verbatim and can outlive the release whose contract
  // it was checked against (`toChange`'s note). Such a change can only be
  // dismissed; here it is refused by name before anything is decided.
  const commandsOf = new Map<string, BatchableCommand[]>();
  for (const row of found) {
    const parsed = BatchableCommand.array().min(1).safeParse(row.change.commands);
    if (!parsed.success) return refuseFor("no-longer-applies", row, "no longer applies: this version of the app cannot read it.");
    commandsOf.set(row.change.id, parsed.data);
  }

  const ordered = [...found].sort(
    (a, b) =>
      a.suggestion.createdAt.getTime() - b.suggestion.createdAt.getTime() ||
      a.suggestion.id.localeCompare(b.suggestion.id) ||
      a.change.position - b.change.position,
  );
  const origin: Origin = {
    kind: "suggestions",
    changes: ordered.map((r) => ({ suggestionId: r.suggestion.id, changeId: r.change.id })),
    authorIds: [...new Set(ordered.map((r) => r.suggestion.authorId))],
    // Only when it is true of every change, so the line is never wrong about one (ADR-067).
    ...(ordered.every((r) => r.suggestion.via === "assistant") ? { via: "assistant" as const } : {}),
  };

  // Conditional on `pending`, as a single accept's is (W10): one change lost
  // to a concurrent resolve throws, and takes the whole batch with it.
  const resolution = { status: "accepted", resolvedBy: reviewerId, resolvedAt: new Date(now) };
  const mark = async (tx: Pick<typeof db, "update">) => {
    await expireStale(tx, tripId, new Date(now));
    const marked = await tx
      .update(tripSuggestionChanges)
      .set(resolution)
      .where(and(inArray(tripSuggestionChanges.id, ids), eq(tripSuggestionChanges.status, "pending")))
      .returning({ id: tripSuggestionChanges.id });
    if (marked.length < ids.length) {
      const won = new Set(marked.map((m) => m.id));
      throw new SuggestionAlreadyResolved(ids.find((id) => !won.has(id)));
    }
  };
  try {
    const result = await executeTripCommandBatch(
      ordered.flatMap((r) => commandsOf.get(r.change.id)!),
      reviewerId,
      mark,
      { origin, runOnNoOp: true },
    );
    // `no-op` committed the mark: every change was already true (W52).
    if (!result.ok && result.error.code !== "no-op") {
      // A lapse between the role read above and the pipeline's own check.
      if (result.error.code === "forbidden") return refuse("forbidden", result.error.message);
      return await whichNoLongerApplies(tripId, ordered, commandsOf, result.error.message);
    }
  } catch (error) {
    if (error instanceof SuggestionAlreadyResolved) {
      return refuseFor("already-resolved", byId.get(error.message) ?? error.message, "was already resolved.");
    }
    throw error;
  }
  return { ok: true, value: ordered.flatMap((r) => toChange({ ...r.change, ...resolution }, r.suggestion) ?? []) };
}

/**
 * The pipeline decides the concatenated commands as one list and says why it
 * stopped, not at which change. So decide them again change by change, with
 * the domain's own `predictBatch` against the trip as it now stands, to name
 * the first one refused. A read after the refusal, for the message only: if
 * the trip moved in between, the refusal still stands and is told unnamed.
 */
async function whichNoLongerApplies(
  tripId: string,
  ordered: readonly Row[],
  commandsOf: ReadonlyMap<string, BatchableCommand[]>,
  why: string,
): Promise<{ ok: false; error: SuggestionError }> {
  let detail: TripDetail | null = await getTripDetail(tripId);
  for (const row of ordered) {
    if (detail === null) break;
    const predicted = predictBatch(detail, commandsOf.get(row.change.id)!, { skipNoOps: true });
    if (predicted.ok) detail = predicted.detail;
    else if (predicted.rejection.code !== "no-op") {
      return refuseFor("no-longer-applies", row, `no longer applies: ${predicted.rejection.message}`);
    }
  }
  return refuse("no-longer-applies", `One of these changes no longer applies: ${why} Nothing was accepted.`);
}
