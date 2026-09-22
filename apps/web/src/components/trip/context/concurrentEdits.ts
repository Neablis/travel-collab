import type { BatchableCommand, Conflict, TripDetail } from "@tc/contracts";
import { activityStatesEqual } from "@tc/predict";

/**
 * Two people editing the same stop, as a conflict rather than a modal
 * (M13 link 4).
 *
 * AGENTS.md invariant 3 and the M1 soft-conflict engine already say what this
 * product does when it notices something wrong: it produces a `Conflict` —
 * data, sitting in the banner, dismissible, never blocking. A concurrent edit
 * is another kind of thing the trip knows is wrong, so it takes the same shape
 * and renders through the same `ConflictBanner` with no new surface.
 *
 * **Why it is not a rule in `detectConflicts`.** Every rule there is
 * `(state, ctx) => Conflict[]` — a pure function of the trip. This one cannot
 * be: it exists precisely because of something the trip does NOT contain, the
 * caller's own unsent queue. A stop that two people edited looks completely
 * ordinary in the resulting state; what makes it a conflict is that one of the
 * two edits has not been sent yet. So it is computed here, at the overlay, and
 * merged into the same `conflicts` array the board already renders.
 */
export const CONCURRENT_EDIT_KIND = "concurrent-edit";

const conflictId = (activityId: string) => `${CONCURRENT_EDIT_KIND}:${activityId}`;

/**
 * The stops a queued command is about.
 *
 * All four activity commands carry `activityId` (`AddActivity`,
 * `UpdateActivity`, `MoveActivity`, `RemoveActivity`), so this is a property
 * test on the command rather than a type switch that a fifth one could be
 * added behind without anyone noticing.
 */
export function activityTargets(commands: readonly BatchableCommand[]): string[] {
  const ids = new Set<string>();
  for (const command of commands) {
    if ("activityId" in command && typeof command.activityId === "string") {
      ids.add(command.activityId);
    }
  }
  return [...ids];
}

/**
 * Conflicts for stops that moved underneath unsent work.
 *
 * `before` is the trip as the client last had it confirmed; `after` is the
 * authoritative trip that has just arrived. A stop conflicts when it existed in
 * `before`, the caller has queued work naming it, and the server's copy has
 * since changed or gone.
 *
 * **A stop the caller ADDED locally can never collide**, and that falls out
 * rather than being special-cased: its id is in neither `before` nor `after`,
 * and the first test below is presence in `before`.
 *
 * Equality is `activityStatesEqual`, the domain's own field-by-field
 * comparison, and not a structural or JSON one. That is what makes this
 * inherit `KI-2026-09-05-o`'s guarantee: `FIELD_EQUAL` is a
 * `Record<keyof ActivityState, …>`, so a ninth activity field is a compile
 * error there and this detector starts seeing it in the same commit rather
 * than silently ignoring edits to it. An `ActivityView` is the eight snapshot
 * fields plus `activityId`, so it satisfies `ActivityState` structurally.
 */
export function concurrentEditConflicts(
  queuedTargets: readonly string[],
  before: TripDetail,
  after: TripDetail,
): Conflict[] {
  const conflicts: Conflict[] = [];
  for (const activityId of queuedTargets) {
    const mine = before.activities[activityId];
    if (!mine) continue;
    const theirs = after.activities[activityId];

    if (!theirs) {
      conflicts.push({
        id: conflictId(activityId),
        kind: CONCURRENT_EDIT_KIND,
        severity: "warn",
        subjects: [activityId],
        description: `"${mine.title}" was removed on the server while you had an unsent change to it.`,
        resolutions: [
          "Send your change anyway — it will re-add the stop",
          "Undo your change to let the removal stand",
        ],
      });
      continue;
    }

    if (!activityStatesEqual(mine, theirs)) {
      conflicts.push({
        id: conflictId(activityId),
        kind: CONCURRENT_EDIT_KIND,
        severity: "warn",
        subjects: [activityId],
        // Deliberately not "someone else": this same path runs when the caller
        // themselves applied an outcome the queue did not produce (inserting a
        // saved day, the assistant applying a proposal). The collision is real
        // in both cases and the wording is true in both.
        description: `"${theirs.title}" changed on the server while you had an unsent change to it.`,
        resolutions: [
          "Send your change anyway — it will overwrite theirs",
          "Undo your change to keep the server's version",
        ],
      });
    }
  }
  return conflicts;
}

/**
 * Drop conflicts about stops nothing is queued against any more.
 *
 * A concurrent-edit conflict is about UNSENT work, so it stops being true the
 * moment that work is sent — which is `confirmHead`, on every successful send.
 * Nothing persists it and nothing needs to dismiss it: it is derived from the
 * queue, and it leaves with the queue. That is why this takes no outcome and
 * makes no new conflicts.
 */
export function pruneResolved(
  conflicts: readonly Conflict[],
  queuedTargets: readonly string[],
): Conflict[] {
  const live = new Set(queuedTargets);
  return conflicts.filter((c) => c.subjects.some((s) => live.has(s)));
}
