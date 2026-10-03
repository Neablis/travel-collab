import { createHash } from "node:crypto";
import type { SuggestionChange, SuggestionChangeStatus, TripRole } from "@tc/contracts";
import { tripAccessFor } from "../access/trip-access";
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
  | "malformed-trip";

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

/** A stored change as the contract serves it. `mode: "date"` columns, so one ISO rendering (KI-53). */
export function toChange(row: ChangeRow, suggestion: Pick<SuggestionRow, "authorId" | "note">): SuggestionChange {
  return {
    id: row.id,
    suggestionId: row.suggestionId,
    tripId: row.tripId,
    authorId: suggestion.authorId,
    note: suggestion.note,
    createdAt: row.createdAt.toISOString(),
    commands: row.commands,
    description: row.description,
    status: row.status as SuggestionChangeStatus,
    dependsOn: row.dependsOn,
    resolvedBy: row.resolvedBy,
    resolvedAt: row.resolvedAt === null ? null : row.resolvedAt.toISOString(),
  };
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
