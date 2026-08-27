import type { TripCommand, TripMember, TripRole } from "@tc/contracts";

export interface AccessPolicy {
  canExecute(
    actorId: string,
    commandType: TripCommand["type"],
    members: TripMember[] | null,
  ): boolean;
}

const RANK: Record<TripRole, number> = { viewer: 0, editor: 1, owner: 2 };

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

// Phase 1 stays single-player in practice: TripCreated mints the creator as
// `owner` and no command adds a member, so `editor`/`viewer` are unreachable
// until invites (M11 link 3) create them. This is the AccessPolicy swap the
// milestone calls for (AGENTS.md invariant 6c) — the callers do not change
// when that happens.
export const memberRolePolicy: AccessPolicy = {
  canExecute(actorId, commandType, members) {
    if (commandType === "CreateTrip") return true;
    const role = members?.find((m) => m.userId === actorId)?.role;
    if (role === undefined) return false;
    return RANK[role] >= RANK[MINIMUM_ROLE[commandType]];
  },
};
