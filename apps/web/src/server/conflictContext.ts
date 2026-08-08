import type { ConflictContext } from "@tc/domain";

// The M3 injection point (ADR-006). Permissive holiday stub — publicHoliday
// anchors stay inert until `date-holidays` is wired here.
export function serverConflictContext(): ConflictContext {
  return {
    isPublicHoliday: () => true,
  };
}
