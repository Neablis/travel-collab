import { z } from "zod";
import type { TripDetail } from "@tc/contracts";

// What applying a Playbook reports beside the ids (ADR-050, Pass B). Warnings
// only: conflicts are data, never a reason to drop a stop (invariant 3), so the
// apply has already happened by the time any of this is computed.

export const ApplicationWarning = z.discriminatedUnion("code", [
  z.object({
    code: z.literal("conflict"),
    conflictId: z.string(),
    activityIds: z.array(z.string().uuid()),
    message: z.string(),
  }),
  z.object({
    code: z.literal("weekday-mismatch"),
    activityId: z.string().uuid(),
    message: z.string(),
  }),
]);
export type ApplicationWarning = z.infer<typeof ApplicationWarning>;

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/** A `YYYY-MM-DD`'s weekday, from explicit UTC components — a calendar fact, not a clock read. */
function weekdayOf(iso: string): (typeof WEEKDAYS)[number] {
  const [y, m, d] = iso.split("-").map(Number);
  return WEEKDAYS[new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay()]!;
}

/**
 * The warnings an apply earns, from the trip before and after it.
 *
 * - **`conflict`**: a conflict the trip did not have before that involves one of
 *   the new stops. One that only names the trip — over budget — is not
 *   attributed to the apply, because it names no stop to look at.
 * - **`weekday-mismatch`**: a new stop anchored to weekdays that landed on a
 *   dated day which is none of them. A dateless trip has no weekdays to miss.
 *   The conflict engine raises its own `anchor-violation` for the same stop;
 *   this says it in the apply's terms.
 */
export function applicationWarnings(
  before: Pick<TripDetail, "conflicts">,
  after: Pick<TripDetail, "conflicts" | "days" | "activities">,
  newActivityIds: readonly string[],
): ApplicationWarning[] {
  const fresh = new Set(newActivityIds);
  const had = new Set(before.conflicts.map((c) => c.id));
  const warnings: ApplicationWarning[] = [];

  for (const conflict of after.conflicts) {
    if (had.has(conflict.id) || !conflict.subjects.some((s) => fresh.has(s))) continue;
    warnings.push({
      code: "conflict",
      conflictId: conflict.id,
      activityIds: conflict.subjects.filter((s) => after.activities[s] !== undefined),
      message: conflict.description,
    });
  }

  for (const day of after.days) {
    if (day.date === null) continue;
    const weekday = weekdayOf(day.date);
    for (const activityId of day.activityIds) {
      if (!fresh.has(activityId)) continue;
      const wanted = after.activities[activityId]?.anchors.flatMap((a) =>
        a.kind === "dayOfWeek" ? [a.days] : [],
      );
      if (wanted === undefined || wanted.length === 0) continue;
      if (wanted.every((days) => days.includes(weekday))) continue;
      warnings.push({
        code: "weekday-mismatch",
        activityId,
        message: `This stop is anchored to ${wanted.flat().join(", ")}, and landed on a ${weekday} (${day.date}).`,
      });
    }
  }
  return warnings;
}

/**
 * One line per apply outcome, `ai.ask`'s shape: a name, then one JSON object.
 *
 * **Ids and counts only.** A Playbook's titles and notes are someone's writing,
 * and a log line is not where they go.
 */
export interface ApplyLogRecord {
  event: "api.playbook.apply";
  outcome: "ok" | "rejected" | "replayed";
  /** Why a rejected apply was refused; null otherwise. */
  reason: string | null;
  userId: string;
  tripId: string;
  playbookId: string;
  placement: "append" | "startingAt";
  playbookVersion: number | null;
  dayCount: number | null;
  createdDayCount: number | null;
  activityCount: number | null;
  warningCount: number | null;
  historySeq: number | null;
  status: number;
}

/** Write one `api.playbook.apply` line: the name, then the record as JSON (see `ApplyLogRecord`). */
export function logApply(record: Omit<ApplyLogRecord, "event">): void {
  console.info("api.playbook.apply", JSON.stringify({ event: "api.playbook.apply", ...record }));
}
