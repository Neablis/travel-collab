import { createHash } from "node:crypto";
import { and, eq, gte, lt, type SQL } from "drizzle-orm";
import { SuggestionChange, type TripRole } from "@tc/contracts";
import { tripAccessFor } from "../access/trip-access";
import type { db } from "../db/client";
import { tripSuggestionChanges, tripSuggestions } from "../db/schema";

// The Suggestions module's refusals (ADR-064). Expected outcomes, so they are
// returned rather than thrown — `access/invites.ts`'s `AccessResult` shape. The
// routes (T5) turn a code into a status; nothing here knows HTTP.
export type SuggestionErrorCode =
  | "not-found"
  | "forbidden"
  | "invalid"
  // A unit that does not apply to the trip as it stands now (spec W4).
  | "does-not-apply"
  // Accepting a change before a change it depends on (spec W9).
  | "dependency-pending"
  | "already-resolved"
  // Accepting a change whose commands the pipeline now refuses (spec W10).
  | "no-longer-applies"
  // The trip's stored document does not parse: the access seam's own denial,
  // answered by this module rather than thrown through it.
  | "malformed-trip"
  // A draft that would take its author or the trip past the open-change caps.
  | "too-many-pending"
  // Resolving a change left pending past `SUGGESTION_TTL_DAYS`.
  | "expired";

export type SuggestionError = {
  code: SuggestionErrorCode;
  message: string;
  /** For `does-not-apply`: the index of the first unit that did not apply. */
  index?: number;
};

export type SuggestionResult<T> = { ok: true; value: T } | { ok: false; error: SuggestionError };

/** A refused {@link SuggestionResult} carrying `code` and `message`, for the module's expected refusals. */
export function refuse(code: SuggestionErrorCode, message: string): { ok: false; error: SuggestionError } {
  return { ok: false, error: { code, message } };
}

/**
 * How many changes may be open at once (Mitchell, 2026-10-03): per author on
 * a trip, and on the trip in all. A draft counts in full, so it is taken or
 * refused whole. The list a reviewer reads, and every resolve's dependency
 * walk, stay bounded by these rather than by how long nobody looked.
 *
 * A bound, not a lock: two drafts sent at the same moment are each counted
 * without the other, so a race can pass a cap by at most one draft.
 */
export const SUGGESTION_AUTHOR_PENDING_MAX = 50;
export const SUGGESTION_TRIP_PENDING_MAX = 200;

/**
 * A pending change older than this is expired (Mitchell, 2026-10-03): left out
 * of the list, the revision and the caps at once, refused on resolve, and
 * recorded `expired` by the next write on the trip's suggestions.
 */
export const SUGGESTION_TTL_DAYS = 90;

const DAY_MS = 86_400_000;

/** The oldest `created_at` a change may have and still be open at `now`. */
function openSince(now: Date): Date {
  return new Date(now.getTime() - SUGGESTION_TTL_DAYS * DAY_MS);
}

/** Pending and within the TTL: what the list, the revision and the caps count. */
export function openAt(now: Date): SQL {
  return and(eq(tripSuggestionChanges.status, "pending"), gte(tripSuggestionChanges.createdAt, openSince(now)))!;
}

/** Whether a change is expired at `now`, recorded or not yet. */
export function isExpired(row: Pick<ChangeRow, "status" | "createdAt">, now: Date): boolean {
  return row.status === "expired" || (row.status === "pending" && row.createdAt < openSince(now));
}

/**
 * Record every change on the trip that has aged out as `expired`. There is no
 * cron to do it (vercel.json declares none, and `og/limit.ts`'s sweep belongs
 * to its own route), so it runs inside each write on the trip's suggestions,
 * in that write's transaction. Until then the reads above already treat the
 * row as expired, so nothing waits on it.
 */
export async function expireStale(tx: Pick<typeof db, "update">, tripId: string, now: Date): Promise<void> {
  await tx
    .update(tripSuggestionChanges)
    .set({ status: "expired", resolvedAt: now })
    .where(
      and(
        eq(tripSuggestionChanges.tripId, tripId),
        eq(tripSuggestionChanges.status, "pending"),
        lt(tripSuggestionChanges.createdAt, openSince(now)),
      ),
    );
}

/**
 * The reader's role on this trip, from `tripAccessFor` — the one place that
 * decides who may read a trip, on the EFFECTIVE member list, so a lapse that
 * caps a suggester or an editor to viewer caps them here too (spec §2.7).
 *
 * Asked at `viewer`, so the seam's `forbidden` means "not a member", which is
 * `not-found` here (W26). Its `malformed-trip` comes back as a refusal; the
 * seam has already logged why (review of #308).
 */
export async function roleOn(tripId: string, userId: string): Promise<SuggestionResult<TripRole>> {
  const access = await tripAccessFor(userId, tripId, "viewer");
  if (access.ok) return { ok: true, value: access.role };
  return access.denial === "malformed-trip"
    ? refuse("malformed-trip", "This trip could not be read.")
    : refuse("not-found", "This trip does not exist.");
}

/** A stored change, as `trip_suggestion_changes` holds it. */
export type ChangeRow = typeof tripSuggestionChanges.$inferSelect;
/** A stored suggestion, the group its changes were sent in. */
export type SuggestionRow = typeof tripSuggestions.$inferSelect;

/**
 * A stored change as the contract serves it, or null — logged — when the row
 * no longer parses. `mode: "date"` columns, so one ISO rendering (KI-53).
 *
 * **Lenient per row, never per list** (review of #308). `commands` is stored
 * verbatim and kept for up to `SUGGESTION_TTL_DAYS`, so a row can outlive the
 * release whose `BatchableCommand` it was checked against. The contract still
 * promises today's commands, so such a row is not served at all: it is left
 * out of what it would have been part of, and the rest is served. Dismiss and
 * withdraw never read `commands`, so it can still be cleared by id; accept
 * replays them through the pipeline, which refuses them as `invalid-command`
 * and so `no-longer-applies`. The revision is taken over the rows, not over
 * what was served, so the list and the poll still agree.
 */
export function toChange(row: ChangeRow, suggestion: Pick<SuggestionRow, "authorId" | "note">): SuggestionChange | null {
  const parsed = SuggestionChange.safeParse({
    id: row.id,
    suggestionId: row.suggestionId,
    tripId: row.tripId,
    authorId: suggestion.authorId,
    note: suggestion.note,
    createdAt: row.createdAt.toISOString(),
    commands: row.commands,
    description: row.description,
    status: row.status,
    dependsOn: row.dependsOn,
    resolvedBy: row.resolvedBy,
    resolvedAt: row.resolvedAt === null ? null : row.resolvedAt.toISOString(),
  });
  if (parsed.success) return parsed.data;
  // The issues, not the row: the trip and change ids are what make it findable.
  console.error("trip_suggestion_changes row failed SuggestionChange parse", {
    tripId: row.tripId,
    changeId: row.id,
    issues: parsed.error.issues,
  });
  return null;
}

/** {@link toChange} over rows of one suggestion, leaving out any that do not parse. */
export function toChanges(rows: readonly ChangeRow[], suggestion: Pick<SuggestionRow, "authorId" | "note">): SuggestionChange[] {
  return rows.flatMap((row) => toChange(row, suggestion) ?? []);
}

/**
 * The opaque revision of a set of changes (spec W6): it moves when a change
 * appears or changes status, and says nothing else. Sorted first, so the list
 * route and the events poll agree whatever order they read the rows in.
 */
export function revOf(changes: readonly { id: string; status: string }[]): string {
  const canonical = changes
    .map((c) => `${c.id}:${c.status}`)
    .sort()
    .join(",");
  return createHash("sha256").update(canonical).digest("base64url").slice(0, 16);
}
