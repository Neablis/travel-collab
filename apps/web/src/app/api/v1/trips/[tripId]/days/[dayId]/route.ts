import { TripDetail } from "@tc/contracts";
import { orThrow, runCommand } from "@/server/public-api/commands";
import { route } from "@/server/public-api/route";
import { requireCurrentTrip } from "@/server/public-api/current";

export const { DELETE } = route({
  DELETE: {
    summary: "Remove a day from a trip; its stops move to the unscheduled backlog",
    scope: "trips:write",
    orScope: "current:write",
    trip: "path",
    role: "editor",
    response: TripDetail,
    handle: async ({ actor, params, trip }) => {
      requireCurrentTrip(actor, trip!, "trips:write", "current:write", Date.now());
      return orThrow(
        await runCommand(actor, {
          type: "RemoveDay",
          tripId: params["tripId"]!,
          dayId: params["dayId"]!,
        }),
      );
    },
  },
});
