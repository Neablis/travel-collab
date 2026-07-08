import type { TripMember } from "@tc/contracts";

export interface AccessPolicy {
  canExecute(
    actorId: string,
    commandType: string,
    members: TripMember[] | null,
  ): boolean;
}

// Phase 1: single-player. Creating is open to any authenticated actor;
// everything else requires membership. Phase 2 swaps this implementation,
// never the callers (AGENTS.md invariant 6c).
export const soleMemberPolicy: AccessPolicy = {
  canExecute(actorId, commandType, members) {
    if (commandType === "CreateTrip") return true;
    return members?.some((m) => m.userId === actorId) ?? false;
  },
};
