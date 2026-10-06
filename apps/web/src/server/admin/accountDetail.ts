// **The operator console's account page, as one read** (M36 link 3).
//
// It lives outside `server/entitlements/` because half of it is about trips —
// which ones an account owns, what it edited — and that module does not know
// what a trip is (ADR-045 rule 5). The plan, grant and ledger half is
// Entitlements' own `adminAccount.ts`; this adds the planning half and joins them.
//
// **Read-only, and reads of the log are not writes through it** (invariant 1).
// `events` is read for who did what and when, and `describeEvent` puts a verb
// on each row; nothing here replays a stream or decides what an event did.
//
// **D5: only what has a source.** Notebooks is a count of `saved_notebooks`;
// *shared* and *started N trips* need a share link and an adds ledger that do
// not exist, so they are not fields here and the page does not draw them.
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { events, savedNotebooks, tripMemberships, tripSummaries } from "@/server/db/schema";
import { TRAILING_WINDOW_DAYS, trailingWindowStart } from "@/server/entitlements/admin";
import {
  adminAccountAssistant,
  adminAccountPlan,
  type AdminAccountAssistant,
  type AdminAccountMoment,
  type AdminAccountPlan,
} from "@/server/entitlements/adminAccount";
import { describeEvent } from "./describeEvent";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Everything the account page draws for one account. */
export interface AdminAccountDetail {
  windowDays: number;
  plan: AdminAccountPlan;
  assistant: AdminAccountAssistant;
  /** Distinct days in the window with a planning event or an assistant turn (D6). */
  activeDays: number;
  /** Active trips it owns, and active trips it joined by invite. */
  trips: { owned: number; invitedTo: number };
  /** Saved notebooks it owns and has not deleted. */
  notebooks: number;
  activity: {
    /** Planning events it wrote, per day, oldest first. */
    editsPerDay: number[];
    /** Its six newest planning events, newest first, as sentences. */
    recent: AdminAccountMoment[];
  };
}

/** One account's page, or `null` when there is no such account. */
export async function adminAccountDetail(
  userId: string,
  now: Date = new Date(),
): Promise<AdminAccountDetail | null> {
  const plan = await adminAccountPlan(userId, now);
  if (plan === null) return null;
  const since = trailingWindowStart(now).toISOString();
  const owns = sql`${tripSummaries.members} @> ${JSON.stringify([{ userId, role: "owner" }])}::jsonb`;

  const [assistant, edits, recentEvents, owned, invited, notebooks] = await Promise.all([
    adminAccountAssistant(plan, now),
    // Bucketed in the database — a row per day it edited, not per event. `ago`
    // is `windowDayOf`'s whole 24-hour periods before `now`, taken at a JS
    // Date's millisecond precision so an edit lands on the same bar here as
    // it would there.
    db
      .select({
        ago: sql<number>`floor((extract(epoch from ${now.toISOString()}::timestamptz) - extract(epoch from date_trunc('milliseconds', ${events.occurredAt}))) * 1000 / ${DAY_MS})::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(events)
      .where(and(eq(events.actorId, userId), gte(events.occurredAt, since)))
      .groupBy(sql`1`),
    // Not bounded by the window: the six newest are the six newest, however
    // long ago — an account idle for two months still has a last thing it did.
    db
      .select({ type: events.type, payload: events.payload, streamId: events.streamId, at: events.occurredAt })
      .from(events)
      .where(eq(events.actorId, userId))
      // By when it happened — the column the page dates it with — and the log's
      // own order between events of the same instant.
      .orderBy(desc(events.occurredAt), desc(events.globalSeq))
      .limit(6),
    // **The owner has no membership row** — `TripCreated` mints them into the
    // summary's member list, and `trip_memberships` is one row per accepted
    // invite (the same two sources `listTripSummariesVisibleTo` ORs together).
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(tripSummaries)
      .where(and(eq(tripSummaries.status, "active"), owns)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(tripMemberships)
      .innerJoin(tripSummaries, eq(tripSummaries.tripId, tripMemberships.tripId))
      .where(
        and(eq(tripMemberships.userId, userId), eq(tripSummaries.status, "active"), sql`not (${owns})`),
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(savedNotebooks)
      .where(and(eq(savedNotebooks.ownerId, userId), isNull(savedNotebooks.deletedAt))),
  ]);

  const editsPerDay = Array.from({ length: TRAILING_WINDOW_DAYS }, () => 0);
  for (const { ago, count } of edits) {
    if (ago >= 0 && ago < TRAILING_WINDOW_DAYS) editsPerDay[TRAILING_WINDOW_DAYS - 1 - ago] = count;
  }
  // The same two sources as *Last active* (`lastActiveSince`), on the same days.
  const activeDays = editsPerDay.filter((count, day) => count > 0 || assistant.perDay[day]! > 0).length;

  // Names as they are now. A stream with no summary row — none should exist,
  // but the log is not keyed to the projection — reads as "a trip".
  const streamIds = [...new Set(recentEvents.map((event) => event.streamId))];
  const names =
    streamIds.length === 0
      ? new Map<string, string>()
      : new Map(
          (
            await db
              .select({ tripId: tripSummaries.tripId, name: tripSummaries.name })
              .from(tripSummaries)
              .where(inArray(tripSummaries.tripId, streamIds))
          ).map((row) => [row.tripId, row.name]),
        );

  return {
    windowDays: TRAILING_WINDOW_DAYS,
    plan,
    assistant,
    activeDays,
    trips: { owned: owned[0]?.count ?? 0, invitedTo: invited[0]?.count ?? 0 },
    notebooks: notebooks[0]?.count ?? 0,
    activity: {
      editsPerDay,
      recent: recentEvents.map((event) => ({
        at: new Date(event.at).toISOString(),
        what: describeEvent(event.type, event.payload, names.get(event.streamId) ?? null),
      })),
    },
  };
}
