import { eq } from "drizzle-orm";
import { ActivityView, type BatchableCommand, type ChatLink, type TripDetail } from "@tc/contracts";
import { tripNow } from "@tc/pages";
import { displayNameFor } from "@/lib/displayName";
import { db } from "../db/client";
import { users } from "../db/schema";
import { buildTripGlobals } from "../tripGlobals";
import { postSystemLine } from "./messages";

// Change lines (M52 decision 17, ADR-073's 2026-10-23 amendment): while a trip
// is under way, a change someone makes to today's or tomorrow's stops is said
// in the chat, so the people already out on the day hear of it. Posted after
// the batch commits, from the trip as it was and as it now is; the chat is its
// own store (ADR-073), so the line is not part of the planning write.

/** The server has no device clock: a day with no placed stop is read on UTC's. */
const SERVER_ZONE = "UTC";

/** Today's and tomorrow's day ids while the trip is under way at `at`; null otherwise. */
function daysAhead(detail: TripDetail, at: number): ReadonlySet<string> | null {
  const now = tripNow(detail, buildTripGlobals(detail), { at, deviceZone: SERVER_ZONE });
  if (now.phase !== "underway") return null;
  const index = detail.days.findIndex((day) => day.dayId === now.dayId);
  return new Set(detail.days.slice(index, index + 2).map((day) => day.dayId));
}

const dayOf = (detail: TripDetail, activityId: string) =>
  detail.days.find((day) => day.activityIds.includes(activityId))?.dayId ?? null;

/**
 * The stops these commands name, in command order: only those, so a write by
 * someone else landing between the two reads is never announced as this one.
 * A removed day takes its stops with it.
 */
function namedStops(commands: readonly BatchableCommand[], before: TripDetail): string[] {
  const ids = commands.flatMap((command) => {
    if ("activityId" in command) return [command.activityId];
    if (command.type === "RemoveDay") return before.days.find((day) => day.dayId === command.dayId)?.activityIds ?? [];
    return [];
  });
  return [...new Set(ids)];
}

// Parsed, so a projection read back from jsonb and one just built compare by
// value whatever their key order or defaulted fields.
const sameStop = (a: unknown, b: unknown) => JSON.stringify(ActivityView.parse(a)) === JSON.stringify(ActivityView.parse(b));

/** What the change did to one stop, as the line says it after the actor's name. */
function phrase(before: ActivityView | undefined, after: ActivityView | undefined, dayWord: (dayId: string | null) => string, days: [string | null, string | null]): string {
  if (after === undefined) return `removed “${before!.title}”`;
  if (before === undefined) return `added “${after.title}” to ${dayWord(days[1])}`;
  if (days[0] !== days[1]) return `moved “${after.title}” to ${dayWord(days[1])}`;
  if (after.timeWindow !== null && after.timeWindow.start !== before.timeWindow?.start) return `moved “${after.title}” to ${after.timeWindow.start}`;
  return `changed “${after.title}”`;
}

/**
 * What a committed change's line says after the actor's name, or null when it
 * is not one to announce: the trip is not under way, or no stop it names on
 * today or tomorrow changed. The first such stop is said and linked; any more
 * are counted.
 */
export function changeLine(
  commands: readonly BatchableCommand[],
  before: TripDetail,
  after: TripDetail,
  at: number,
): { words: string; link: ChatLink | undefined } | null {
  const ahead = daysAhead(after, at);
  if (ahead === null) return null;
  const [today, tomorrow] = [...ahead];
  const dayWord = (dayId: string | null) => {
    if (dayId === null) return "the backlog";
    if (dayId === today) return "today";
    if (dayId === tomorrow) return "tomorrow";
    return `day ${after.days.findIndex((day) => day.dayId === dayId) + 1}`;
  };
  const touched = namedStops(commands, before).flatMap((id) => {
    const days: [string | null, string | null] = [dayOf(before, id), dayOf(after, id)];
    const was = before.activities[id];
    const is = after.activities[id];
    if (!days.some((day) => day !== null && ahead.has(day))) return [];
    if (was !== undefined && is !== undefined && days[0] === days[1] && sameStop(was, is)) return [];
    return [{ id, words: phrase(was, is, dayWord, days), stays: is !== undefined }];
  });
  const [first, ...rest] = touched;
  if (first === undefined) return null;
  const more = rest.length === 0 ? "" : `, and changed ${rest.length} more stop${rest.length === 1 ? "" : "s"}`;
  return { words: `${first.words}${more}`, link: first.stays ? { kind: "stop", id: first.id } : undefined };
}

/**
 * Post the change line for a batch that has committed, if it is one. Never
 * throws: the change stands either way, and a lost line is logged rather than
 * turned into a failed accept.
 */
export async function announceChange(
  tripId: string,
  actorId: string,
  commands: readonly BatchableCommand[],
  before: TripDetail,
  after: TripDetail,
  now: Date = new Date(),
): Promise<void> {
  try {
    const line = changeLine(commands, before, after, now.getTime());
    if (line === null) return;
    // By display name, never address: everyone on the trip reads the line.
    const [person] = await db.select({ displayName: users.displayName, name: users.name }).from(users).where(eq(users.id, actorId));
    await postSystemLine(tripId, actorId, `${displayNameFor({ userId: actorId, ...person })} ${line.words}`, line.link, now);
  } catch (error) {
    console.error("chat: the change line was not posted", { tripId, error });
  }
}
