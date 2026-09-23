import { TripDetail } from "@tc/contracts";
import { orThrow, runCommand } from "@/server/public-api/commands";
import { route } from "@/server/public-api/route";

// Dismissing an overlap warning. A `DELETE` on the conflict, because from the
// caller's side that is exactly what it is — the warning goes away.
export const { DELETE } = route({
  DELETE: {
    summary: "Dismiss a scheduling conflict warning on a trip",
    scope: "trips:write",
    trip: "path",
    role: "editor",
    response: TripDetail,
    handle: async ({ actor, params }) =>
      orThrow(
        await runCommand(actor, {
          type: "DismissConflict",
          tripId: params["tripId"]!,
          conflictId: params["conflictId"]!,
        }),
      ),
  },
});
