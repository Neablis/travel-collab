import type { ConflictContext } from "@tc/domain";
import { serverConfig } from "./config";

// The M3 injection point (ADR-006). Permissive holiday stub — publicHoliday
// anchors stay inert until `date-holidays` is wired here. Timezone is fixed for
// now; per-activity zones are deferred.
export function serverConflictContext(): ConflictContext {
  return {
    isPublicHoliday: () => true,
    timezone: serverConfig.timezone,
  };
}
