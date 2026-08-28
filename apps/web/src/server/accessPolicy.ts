import type { TripCommand, TripMember, TripRole } from "@tc/contracts";

export interface AccessPolicy {
  canExecute(
    actorId: string,
    commandType: TripCommand["type"],
    members: TripMember[] | null,
  ): boolean;
}

const RANK: Record<TripRole, number> = { viewer: 0, editor: 1, owner: 2 };

/** The actor's role on this trip, or null when they are not a member at all. */
export function memberRole(actorId: string, members: TripMember[] | null): TripRole | null {
  return members?.find((m) => m.userId === actorId)?.role ?? null;
}

/**
 * The read/CRUD half of the AccessPolicy seam.
 *
 * `canExecute` answers "may this actor run this planning command"; everything
 * that is NOT a planning command — reading a trip, writing a Notebook page,
 * driving the assistant, managing invites — asks this instead. Both read the
 * same RANK, so there is exactly one place that knows a viewer ranks below an
 * editor (AGENTS.md invariant 6c).
 *
 * M11 link 3 exists partly because this function did not: `pages-guard.ts`
 * checked membership with NO role, so the first viewer the invite flow created
 * would have been able to write pages and drive the assistant.
 */
export function hasAtLeast(
  actorId: string,
  members: TripMember[] | null,
  minimum: TripRole,
): boolean {
  const role = memberRole(actorId, members);
  return role !== null && RANK[role] >= RANK[minimum];
}

// The role a member must hold, at minimum, to run each command. Typed as an
// exhaustive Record so a new TripCommand fails to compile until someone
// decides who may run it — before roles existed every command was reachable by
// any member, and a new command inheriting that by default is exactly the
// silent widening this table is here to stop.
//
// Nothing is minimum "viewer": a viewer holds read access and executes no
// planning command at all.
//
// CreateTrip is excluded because it has no trip to be a member of; it is
// decided before this table is consulted.
const MINIMUM_ROLE: Record<Exclude<TripCommand["type"], "CreateTrip">, TripRole> = {
  AddDay: "editor",
  RemoveDay: "editor",
  SetTripStartDate: "editor",
  SetTripName: "editor",
  SetTripDates: "editor",
  AddActivity: "editor",
  UpdateActivity: "editor",
  MoveActivity: "editor",
  RemoveActivity: "editor",
  DismissConflict: "editor",
  SetTripCurrency: "editor",
  SetTripBudget: "editor",
  // History commands rewrite the plan but never destroy the log — an undo is
  // itself appended (ADR-005), so an editor undoing an owner's change is as
  // recoverable as any other edit.
  UndoLastChange: "editor",
  RedoChange: "editor",
  RevertToState: "editor",
  // Stream-level and destructive. The same line BatchableCommand already draws
  // for the AI tool surface: an editor plans the trip, an owner decides
  // whether it exists.
  DeleteTrip: "owner",
  RestoreTrip: "owner",
};

// M11 link 3 made `editor`/`viewer` reachable: `TripCreated` still mints the
// creator as `owner` and still no planning command adds a member, but the
// Access module's `trip_memberships` rows are merged into the member list the
// callers pass in (`server/access/members.ts`). That is the AccessPolicy swap
// the milestone called for (AGENTS.md invariant 6c) — the callers did not
// change shape when it happened, only where their member list comes from.
export const memberRolePolicy: AccessPolicy = {
  canExecute(actorId, commandType, members) {
    if (commandType === "CreateTrip") return true;
    return hasAtLeast(actorId, members, MINIMUM_ROLE[commandType]);
  },
};
