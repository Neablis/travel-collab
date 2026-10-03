import { and, eq, inArray } from "drizzle-orm";
import type { ResolveSuggestionChangeInput, SuggestionChange } from "@tc/contracts";
import { roleAtLeast } from "../accessPolicy";
import { executeTripCommandBatch } from "../commands";
import { db } from "../db/client";
import { tripSuggestionChanges, tripSuggestions } from "../db/schema";
import { isUuid } from "../ids";
import { refuse, roleOn, toChange, type ChangeRow, type SuggestionResult, type SuggestionRow } from "./shared";

/**
 * Thrown from inside the accept batch's transaction when the change is no
 * longer pending — another accept, a dismiss or a withdraw got there first.
 * Throwing rolls the batch back with it, so a double accept appends exactly
 * one batch (spec W10).
 */
export class SuggestionAlreadyResolved extends Error {}

type Action = ResolveSuggestionChangeInput["action"];

const RESOLVED_AS = { accept: "accepted", dismiss: "dismissed", withdraw: "withdrawn" } as const;

/**
 * Accept, dismiss or withdraw one pending change (spec §4, W10, W14).
 *
 * - **Accept and dismiss** need at least `editor`. **Withdraw** is the author's,
 *   and only while they can still see it (at least `suggester`).
 * - **Accept** refuses while any change it depends on is not yet accepted, then
 *   replays its commands through the ordinary pipeline as the reviewer, with
 *   `Origin` `suggestion` (ADR-064). A refusal there leaves the row pending:
 *   the reviewer decides, and accepting must not quietly become dismissing.
 *   A change the trip already reflects throughout is accepted with nothing
 *   appended (W52), in the transaction that decided so (W55).
 * - **Dismiss and withdraw** take every pending change that depends on this
 *   one with it, transitively, in one transaction (spec §2.7).
 *
 * Answers the rows this call resolved, the named change first.
 */
export async function resolveSuggestionChange(
  tripId: string,
  changeId: string,
  actorId: string,
  action: Action,
  now: string = new Date().toISOString(),
): Promise<SuggestionResult<SuggestionChange[]>> {
  // A uuid column: an id that is not one names nothing (KI-2026-09-05-x).
  if (!isUuid(changeId)) return refuse("not-found", "This suggestion does not exist.");
  const access = await roleOn(tripId, actorId);
  if (!access.ok) return access;
  const role = access.value;
  const reviewing = action !== "withdraw";
  if (!roleAtLeast(role, reviewing ? "editor" : "suggester")) {
    return refuse("forbidden", reviewing ? "Only an editor can review a suggestion." : "You cannot withdraw this.");
  }

  const found = await db
    .select({ change: tripSuggestionChanges, suggestion: tripSuggestions })
    .from(tripSuggestionChanges)
    .innerJoin(tripSuggestions, eq(tripSuggestions.id, tripSuggestionChanges.suggestionId))
    .where(and(eq(tripSuggestionChanges.id, changeId), eq(tripSuggestionChanges.tripId, tripId)));
  const row = found[0];
  if (row === undefined) return refuse("not-found", "This suggestion does not exist.");
  const { change, suggestion } = row;
  if (!reviewing && suggestion.authorId !== actorId) {
    // A suggester sees only their own changes (list.ts), so for one of them
    // another's change does not exist; an editor can see it, and is refused.
    return roleAtLeast(role, "editor")
      ? refuse("forbidden", "Only the person who suggested this can withdraw it.")
      : refuse("not-found", "This suggestion does not exist.");
  }
  if (change.status !== "pending") return refuse("already-resolved", "This suggestion was already resolved.");

  return action === "accept"
    ? accept(change, suggestion, actorId, now)
    : cascade(change.id, suggestion, RESOLVED_AS[action], actorId, now);
}

async function accept(
  change: ChangeRow,
  suggestion: SuggestionRow,
  reviewerId: string,
  now: string,
): Promise<SuggestionResult<SuggestionChange[]>> {
  if (change.dependsOn.length > 0) {
    const parents = await db
      .select({ status: tripSuggestionChanges.status })
      .from(tripSuggestionChanges)
      .where(inArray(tripSuggestionChanges.id, change.dependsOn));
    // A dismissed parent took this change with it (the cascade), so a parent
    // that is not accepted here is a pending one. The race with a concurrent
    // dismiss is the hook's to lose, not this read's.
    if (parents.some((p) => p.status !== "accepted")) {
      return refuse("dependency-pending", "Accept the change this one builds on first.");
    }
  }

  // Conditional on `pending`, so exactly one resolution wins (W10): losing it
  // throws, which takes the batch down with it.
  const resolution = { status: "accepted", resolvedBy: reviewerId, resolvedAt: new Date(now) };
  const mark = async (tx: Pick<typeof db, "update">) => {
    const marked = await tx
      .update(tripSuggestionChanges)
      .set(resolution)
      .where(and(eq(tripSuggestionChanges.id, change.id), eq(tripSuggestionChanges.status, "pending")))
      .returning({ id: tripSuggestionChanges.id });
    if (marked.length === 0) throw new SuggestionAlreadyResolved(change.id);
  };
  try {
    const result = await executeTripCommandBatch(change.commands, reviewerId, mark, {
      origin: { kind: "suggestion", suggestionId: suggestion.id, changeId: change.id, authorId: suggestion.authorId },
      // Authorized, and every command is already true — another change asked
      // for the same thing and was accepted first. What it asks for is done, so
      // it is accepted with nothing appended (W52); refusing would leave the
      // reviewer a change that can only be dismissed. Marked inside the
      // pipeline's transaction, which confirms the head did not move under the
      // decision (W55): marked afterwards, a trip write in between would leave a
      // change accepted that the trip no longer says.
      runOnNoOp: true,
    });
    // `no-op` committed the mark above, so it is the accept's success.
    if (!result.ok && result.error.code !== "no-op") {
      // A lapse between the role read above and the pipeline's own check.
      if (result.error.code === "forbidden") return refuse("forbidden", result.error.message);
      return refuse("no-longer-applies", result.error.message);
    }
  } catch (error) {
    if (error instanceof SuggestionAlreadyResolved) {
      return refuse("already-resolved", "This suggestion was already resolved.");
    }
    throw error;
  }
  return { ok: true, value: [toChange({ ...change, ...resolution }, suggestion)] };
}

async function cascade(
  changeId: string,
  suggestion: SuggestionRow,
  status: "dismissed" | "withdrawn",
  actorId: string,
  now: string,
): Promise<SuggestionResult<SuggestionChange[]>> {
  const resolution = { status, resolvedBy: actorId, resolvedAt: new Date(now) };
  return db.transaction(async (tx): Promise<SuggestionResult<SuggestionChange[]>> => {
    // The named change first, conditional on `pending` as accept's is. Losing
    // that race is a refusal, and since nothing has been written yet,
    // returning it commits nothing.
    const named = await tx
      .update(tripSuggestionChanges)
      .set(resolution)
      .where(and(eq(tripSuggestionChanges.id, changeId), eq(tripSuggestionChanges.status, "pending")))
      .returning();
    if (named[0] === undefined) return refuse("already-resolved", "This suggestion was already resolved.");

    // Dependencies never cross a suggestion (spec W9), so its siblings are the
    // whole graph to walk.
    const siblings = await tx
      .select({ id: tripSuggestionChanges.id, dependsOn: tripSuggestionChanges.dependsOn })
      .from(tripSuggestionChanges)
      .where(eq(tripSuggestionChanges.suggestionId, suggestion.id));
    const closure = new Set([changeId]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const s of siblings) {
        if (!closure.has(s.id) && s.dependsOn.some((id) => closure.has(id))) {
          closure.add(s.id);
          grew = true;
        }
      }
    }
    closure.delete(changeId);
    // A dependent already resolved keeps its status. One already accepted
    // cannot exist: accept waits for every parent.
    const dependents =
      closure.size === 0
        ? []
        : await tx
            .update(tripSuggestionChanges)
            .set(resolution)
            .where(and(inArray(tripSuggestionChanges.id, [...closure]), eq(tripSuggestionChanges.status, "pending")))
            .returning();
    return { ok: true, value: [...named, ...dependents].map((r) => toChange(r, suggestion)) };
  });
}
