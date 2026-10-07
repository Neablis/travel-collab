import { z } from "zod";
import { TripCover } from "./cover.ts";
import { AvatarKey, PersonColor } from "./identity.ts";
import {
  ActivityAddedV1,
  ActivityMovedV1,
  ActivityRemovedV1,
  ActivityUpdatedV1,
  AddActivity,
  MoveActivity,
  RemoveActivity,
  kindDetailFieldMessage,
  kindDetailFieldsOffKind,
  UpdateActivity,
} from "./activity.ts";
import {
  ConflictDismissedV1,
  ConflictUndismissedV1,
  DismissConflict,
  RedoChange,
  RevertToState,
  UndoLastChange,
} from "./history.ts";
import { Money } from "./money.ts";

// Where a trip came from, when it came from somewhere (M11 link 5, ADR-028).
//
// Captured at GENESIS and never mutated: it is a fact about how this stream
// began, so it lives in `TripCreated`'s payload rather than in a CRUD table —
// the foundation design has always listed it as part of a Trip ("lineage
// pointer (`forkedFrom: {tripId, atSeq}`)"), and ADR-001 names fork-with-
// lineage as one of the things that falls out of the event log for free.
//
// `name` is the ancestor's name AT THE MOMENT OF THE FORK, deliberately
// copied into the payload rather than looked up. A projection must be
// rebuildable from the log alone (AGENTS.md invariant 2), and a cross-stream
// read at projection time would break that; it also means the credit survives
// the ancestor being renamed, or deleted, or becoming unreadable to the person
// holding the copy — which is the normal case when the copy came from a share
// link handed to a stranger.
export const TripLineage = z.object({
  tripId: z.string().uuid(),
  // The ancestor's history point this was copied from. 1-based, matching
  // `events.seq`.
  atSeq: z.number().int().min(1),
  name: z.string().min(1).max(200),
});
export type TripLineage = z.infer<typeof TripLineage>;

export const CreateTrip = z.object({
  type: z.literal("CreateTrip"),
  tripId: z.string().uuid(),
  name: z.string().min(1).max(200),
  // Only ever set by the server's clone path (`server/cloneTrip.ts`). No
  // client can forge it: `POST /api/trips` accepts a name and nothing else,
  // and `POST /api/trips/:id/commands` refuses `CreateTrip` outright.
  forkedFrom: TripLineage.nullable().default(null),
});
export type CreateTrip = z.infer<typeof CreateTrip>;

export const TripCreatedV1 = z.object({
  type: z.literal("TripCreated"),
  version: z.literal(1),
  payload: z.object({
    tripId: z.string().uuid(),
    name: z.string().min(1).max(200),
    createdBy: z.string().min(1),
    // `.default(null)` rather than `.optional()`: every TripCreated row
    // written before M11 link 5 has no such key, and a default makes those
    // rows parse to an explicit `null` instead of `undefined` — so replay,
    // rebuild and the golden test all see one shape, not two. Additive and
    // backwards compatible; no migration, no event version bump.
    forkedFrom: TripLineage.nullable().default(null),
  }),
});
export type TripCreatedV1 = z.infer<typeof TripCreatedV1>;

export const AddDay = z.object({
  type: z.literal("AddDay"),
  tripId: z.string().uuid(),
  dayId: z.string().uuid(),
});
export type AddDay = z.infer<typeof AddDay>;

export const RemoveDay = z.object({
  type: z.literal("RemoveDay"),
  tripId: z.string().uuid(),
  dayId: z.string().uuid(),
});
export type RemoveDay = z.infer<typeof RemoveDay>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Whether a `YYYY-MM-DD` string names a day that exists on the calendar — the
 * ONE copy, shared by the command schemas below, `pages.ts`'s date filters and
 * the domain's `decide.ts` (which re-exports it), so the boundary and the
 * decider cannot disagree about which dates are real.
 *
 * Parsed as an ISO date, not through `Date.UTC(y, m, d)`: that maps years 0–99
 * to 1900–1999, so `0050-01-01` would be refused here while the domain's parser
 * accepted it. A shape-valid string whose parsed parts differ from its text
 * (`2026-02-30` → March 2) was never a real date. Reads no clock (Invariant 4).
 */
export function isCalendarDate(iso: string): boolean {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (parts === null) return false;
  const dt = new Date(`${iso}T00:00:00Z`);
  return (
    dt.getUTCFullYear() === Number(parts[1]) &&
    dt.getUTCMonth() + 1 === Number(parts[2]) &&
    dt.getUTCDate() === Number(parts[3])
  );
}

// A `YYYY-MM-DD` that names a real day (KI-92): shape alone admits 2026-02-30,
// and the domain's date math can only refuse that by throwing. COMMANDS only —
// the stored `TripStartDateSet` event keeps the shape-only regex, because an
// event is history and must replay even if it predates decide.ts's
// `invalid-dates` check (PR #84).
const TripDateInput = z.string().regex(ISO_DATE).refine(isCalendarDate, "not a calendar date");

// Display-only until M3: the domain and conflict engine never read this.
export const SetTripStartDate = z.object({
  type: z.literal("SetTripStartDate"),
  tripId: z.string().uuid(),
  startDate: TripDateInput.nullable(), // null clears
});
export type SetTripStartDate = z.infer<typeof SetTripStartDate>;

export const SetTripName = z.object({
  type: z.literal("SetTripName"),
  tripId: z.string().uuid(),
  name: z.string().min(1).max(200),
});
export type SetTripName = z.infer<typeof SetTripName>;

export const TripNameSetV1 = z.object({
  type: z.literal("TripNameSet"),
  version: z.literal(1),
  payload: z.object({ tripId: z.string().uuid(), name: z.string().min(1).max(200) }),
});
export type TripNameSetV1 = z.infer<typeof TripNameSetV1>;

// Sets the date range and reconciles day COUNT to match it (decide emits the
// DayAdded/DayRemoved events). `newDayIds` supplies ids for any days the
// reconcile has to append — the domain is pure and cannot mint UUIDs
// (Invariant 4), the same reason AddDay carries its own dayId.
export const SetTripDates = z.object({
  type: z.literal("SetTripDates"),
  tripId: z.string().uuid(),
  startDate: TripDateInput.nullable(),
  endDate: TripDateInput.nullable(),
  newDayIds: z.array(z.string().uuid()).default([]),
});
export type SetTripDates = z.infer<typeof SetTripDates>;

// Soft delete. The stream survives; `status` gates further commands and the
// summaries read model filters it out. RestoreTrip is the exact inverse.
export const DeleteTrip = z.object({
  type: z.literal("DeleteTrip"),
  tripId: z.string().uuid(),
});
export type DeleteTrip = z.infer<typeof DeleteTrip>;

export const TripDeletedV1 = z.object({
  type: z.literal("TripDeleted"),
  version: z.literal(1),
  payload: z.object({ tripId: z.string().uuid() }),
});
export type TripDeletedV1 = z.infer<typeof TripDeletedV1>;

export const RestoreTrip = z.object({
  type: z.literal("RestoreTrip"),
  tripId: z.string().uuid(),
});
export type RestoreTrip = z.infer<typeof RestoreTrip>;

export const TripRestoredV1 = z.object({
  type: z.literal("TripRestored"),
  version: z.literal(1),
  payload: z.object({ tripId: z.string().uuid() }),
});
export type TripRestoredV1 = z.infer<typeof TripRestoredV1>;

export const TripStatus = z.enum(["active", "deleted"]);
export type TripStatus = z.infer<typeof TripStatus>;

export const DayAddedV1 = z.object({
  type: z.literal("DayAdded"),
  version: z.literal(1),
  payload: z.object({ tripId: z.string().uuid(), dayId: z.string().uuid() }),
});
export type DayAddedV1 = z.infer<typeof DayAddedV1>;

// Its activities return to the backlog (evolve semantics).
export const DayRemovedV1 = z.object({
  type: z.literal("DayRemoved"),
  version: z.literal(1),
  payload: z.object({ tripId: z.string().uuid(), dayId: z.string().uuid() }),
});
export type DayRemovedV1 = z.infer<typeof DayRemovedV1>;

export const TripStartDateSetV1 = z.object({
  type: z.literal("TripStartDateSet"),
  version: z.literal(1),
  payload: z.object({ tripId: z.string().uuid(), startDate: z.string().regex(ISO_DATE).nullable() }),
});
export type TripStartDateSetV1 = z.infer<typeof TripStartDateSetV1>;

export const SetTripCurrency = z.object({
  type: z.literal("SetTripCurrency"),
  tripId: z.string().uuid(),
  currency: z.string().regex(/^[A-Z]{3}$/),
});
export type SetTripCurrency = z.infer<typeof SetTripCurrency>;

export const TripCurrencySetV1 = z.object({
  type: z.literal("TripCurrencySet"),
  version: z.literal(1),
  payload: z.object({ tripId: z.string().uuid(), currency: z.string().regex(/^[A-Z]{3}$/) }),
});
export type TripCurrencySetV1 = z.infer<typeof TripCurrencySetV1>;

export const SetTripBudget = z.object({
  type: z.literal("SetTripBudget"),
  tripId: z.string().uuid(),
  budget: Money.nullable(), // null clears
});
export type SetTripBudget = z.infer<typeof SetTripBudget>;

export const TripBudgetSetV1 = z.object({
  type: z.literal("TripBudgetSet"),
  version: z.literal(1),
  payload: z.object({ tripId: z.string().uuid(), budget: Money.nullable() }),
});
export type TripBudgetSetV1 = z.infer<typeof TripBudgetSetV1>;

export const TripEvent = z.discriminatedUnion("type", [
  TripCreatedV1,
  DayAddedV1,
  DayRemovedV1,
  TripStartDateSetV1,
  TripNameSetV1,
  ActivityAddedV1,
  ActivityUpdatedV1,
  ActivityMovedV1,
  ActivityRemovedV1,
  ConflictDismissedV1,
  ConflictUndismissedV1,
  TripCurrencySetV1,
  TripBudgetSetV1,
  TripDeletedV1,
  TripRestoredV1,
]);
export type TripEvent = z.infer<typeof TripEvent>;

/**
 * **A kind-detail field on a stop of another kind is refused here** (M24's
 * travel leg, ADR-055's pending reason): an `AddActivity` whose kind (omitted
 * = "planned") is not `transit` may not carry a `mode` or an `endLocation`,
 * one that is not `pending` may not carry a `pendingReason`, and nor may an
 * `UpdateActivity` that sets such a kind in the same breath. An update that
 * leaves one behind on a stop whose stored kind changes is the decider's to
 * refuse, because only it can see the stored stop.
 *
 * On the UNION, the pattern `Anchor` uses (activity.ts), because zod 3's
 * `discriminatedUnion` accepts only plain objects as members — a refinement on
 * `AddActivity` itself would take it out of both unions below.
 */
function refuseKindDetailOffKind(command: { type: string }, ctx: z.RefinementCtx): void {
  if (command.type !== "AddActivity" && command.type !== "UpdateActivity") return;
  const c = command as AddActivity | UpdateActivity;
  const kind = c.type === "AddActivity" ? (c.kind ?? "planned") : c.kind;
  if (kind === undefined) return;
  for (const field of kindDetailFieldsOffKind({ ...c, kind })) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: kindDetailFieldMessage(field) });
  }
}

const TripCommandUnion = z.discriminatedUnion("type", [
  CreateTrip,
  AddDay,
  RemoveDay,
  SetTripStartDate,
  SetTripName,
  SetTripDates,
  AddActivity,
  UpdateActivity,
  MoveActivity,
  RemoveActivity,
  UndoLastChange,
  RedoChange,
  RevertToState,
  DismissConflict,
  DeleteTrip,
  RestoreTrip,
  SetTripCurrency,
  SetTripBudget,
]);
export const TripCommand = TripCommandUnion.superRefine(refuseKindDetailOffKind);
export type TripCommand = z.infer<typeof TripCommand>;

// Commands eligible for atomic batching (M6): every TripCommand except
// CreateTrip (a trip's genesis), the history commands (decided separately),
// and destructive/stream-level operations (DeleteTrip, RestoreTrip).
const BatchableCommandUnion = z.discriminatedUnion("type", [
  AddDay,
  RemoveDay,
  SetTripStartDate,
  SetTripName,
  SetTripDates,
  AddActivity,
  UpdateActivity,
  MoveActivity,
  RemoveActivity,
  DismissConflict,
  SetTripCurrency,
  SetTripBudget,
]);
export const BatchableCommand = BatchableCommandUnion.superRefine(refuseKindDetailOffKind);
export type BatchableCommand = z.infer<typeof BatchableCommand>;

// ADR-066. The id a client mints for one unit of its send queue, which the
// server records with the unit's events and never applies twice. A UUID in
// practice. Anything URL- and header-safe up to 64 characters is accepted.
export const CommandUnitKey = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
export type CommandUnitKey = z.infer<typeof CommandUnitKey>;

// One queued unit, as `POST /api/trips/:tripId/commands/batch` takes it in
// `units`: its key and its commands, in order. A unit the trip's receipts
// already hold is left out of the batch rather than decided again.
export const TripCommandUnit = z.object({
  key: CommandUnitKey,
  commands: z.array(BatchableCommand).min(1),
});
export type TripCommandUnit = z.infer<typeof TripCommandUnit>;

// Ordered least- to most-privileged; `AccessPolicy` (apps/web/src/server) is
// the only thing that interprets the ranking, and the planning domain never
// reads a role at all (AGENTS.md invariant 6c). `owner` is still the only role
// anything MINTS — TripCreated makes its creator the owner and no command adds
// a member — so editor/viewer are unreachable at runtime until invites (M11
// link 3). Widening a literal to an enum that contains it is backwards
// compatible: every `members` row already persisted in `trip_summaries` /
// `trip_details` jsonb still parses. `suggester` (ADR-064) sits between viewer
// and editor: it reads like a viewer and proposes board edits an editor
// accepts; it never writes the log itself.
export const TripRole = z.enum(["viewer", "suggester", "editor", "owner"]);
export type TripRole = z.infer<typeof TripRole>;

export const TripMember = z.object({
  userId: z.string().min(1),
  role: TripRole,
  // Whether they are on the trip, as against helping plan it (travellers spec
  // D1). Access data, overlaid at read time like the member list itself; the
  // log never knows it. Absent means travelling (D2), and that reading lives in
  // ONE place, `travellerIds` (costs.ts) — read it there, never as a bare
  // `m.travelling`.
  //
  // `.optional()`, not `.default(true)`: the domain folds members as
  // `{ userId, role }` without parsing, so a default materialised on parse
  // would make a stored projection and its rebuild from the log differ
  // (invariant 2), and would type every member literal as missing a field.
  travelling: z.boolean().optional(),
});
export type TripMember = z.infer<typeof TripMember>;

/**
 * **Who a person is, as a trip shows them** (M38): what they chose to be called,
 * and the avatar and colour they picked. The stored choices — a per-trip colour
 * shift (D3) happens at render time and is never part of this. Each field is
 * defaulted for version skew. One copy, spread into `TripMemberProfile` and
 * `TripSummaryMember`, so the two places a member carries a persona cannot
 * disagree about its shape.
 */
export const MemberPersona = z.object({
  displayName: z.string().nullable().default(null),
  avatar: AvatarKey.nullable().default(null),
  color: PersonColor.nullable().default(null),
});

/**
 * A member as the trips LIST carries one (M38 part 3): `TripMember` plus the
 * persona and the sign-in `name`, so a card can name its people. Never an email:
 * a card is read by everyone on the trip.
 *
 * **Not `TripMember`, on purpose.** `TripMember` is planning's — the domain folds
 * it into `trip_summaries` and `trip_details` — and no planning read model grows
 * a name (`TripMemberProfile`'s note). This is overlaid at the list's read
 * boundary from `users`, the way `travelling` and the granted members are
 * (ADR-026, ADR-065), and `StoredTripSummary` keeps the bare `TripMember`.
 */
export const TripSummaryMember = TripMember.extend({
  name: z.string().nullable().default(null),
  ...MemberPersona.shape,
});
export type TripSummaryMember = z.infer<typeof TripSummaryMember>;

export const TripSummary = z.object({
  tripId: z.string().uuid(),
  name: z.string(),
  status: TripStatus,
  members: z.array(TripSummaryMember).min(1),
  createdAt: z.string(), // ISO 8601
  // The trip's first calendar day (`YYYY-MM-DD`), or null for an undated trip
  // (KI-034). What Home chooses its "next trip" by, and what a card prints in
  // place of `createdAt`. The shape-only regex, as on `TripStartDateSet`: this
  // is copied from the event, and history must stay readable.
  //
  // `.default(null)` so a payload from before this field (a cached response,
  // a client or server one deploy behind) parses to an explicit null rather
  // than failing — additive, the same way `forkedFrom` was added.
  startDate: z.string().regex(ISO_DATE).nullable().default(null),
  // The trip's LAST calendar day (`YYYY-MM-DD`), or null when that is unknown:
  // undated, or dated with no days yet (KI-2026-09-24-e). Home needs it to
  // tell a trip that is under way from one that is over. It is the date the
  // trip's own document gives its last day (`TripDetail.days[-1].date`), read
  // alongside the summary rather than stored on it — see
  // `listTripSummariesVisibleTo`. `.default(null)` for the same version skew
  // as `startDate`.
  endDate: z.string().regex(ISO_DATE).nullable().default(null),
  // How many days the trip has, and how many stops sit on them (M37 D5): what
  // a card needs to say the trip's length and to tell an empty trip from a
  // planned one, read from the trip's document in the same query as `endDate`.
  // A stop is an activity placed on a day — the plan's stops. The backlog is
  // not counted: an idea parked there is not yet on the plan, and a card that
  // called a trip with no days "3 stops" would be describing a plan that does
  // not exist. `.default(0)` for the same version skew as `startDate`.
  dayCount: z.number().int().nonnegative().default(0),
  stopCount: z.number().int().nonnegative().default(0),
  // How many activities are in the backlog — the trip's unscheduled ideas. Not
  // stops, for the reason above, but not nothing either: the trip header's
  // *Add stop* puts a stop there, so a trip built that way has no stops and is
  // still not a blank trip. A card reads "4 ideas, none on a day yet" for it.
  ideaCount: z.number().int().nonnegative().default(0),
  // The trip's cover photo, or null for none (M37 D1): a row in the
  // `trip_covers` side table, LEFT JOINed into the same listing query, so a
  // card never fetches it and no page view asks Unsplash for it (D2).
  // `.default(null)` for the same version skew as `startDate`.
  cover: TripCover.nullable().default(null),
});
export type TripSummary = z.infer<typeof TripSummary>;

/**
 * What the `trip_summaries` projection itself holds, and what
 * `projectTripSummaries` folds from the log: a `TripSummary` without the
 * fields the list query reads from the trip's document instead of storing a
 * second copy — `endDate` (KI-2026-09-24-e), and the day, stop and idea counts
 * (M37) — and the cover, which is not planning state at all and lives in its
 * own CRUD table (M37 D1). Its members are the log's bare `TripMember`s: the
 * persona is Identity's, overlaid at read time (M38, `TripSummaryMember`).
 */
export type StoredTripSummary = Omit<
  TripSummary,
  "endDate" | "dayCount" | "stopCount" | "ideaCount" | "cover" | "members"
> & { members: TripMember[] };
