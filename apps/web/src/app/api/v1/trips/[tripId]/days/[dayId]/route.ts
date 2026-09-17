import { TripDetail } from "@tc/contracts";
import { orThrow, runCommand } from "@/server/public-api/commands";
import { route } from "@/server/public-api/route";

export const { DELETE } = route({
  DELETE: {
    scope: "trips:write",
    trip: "path",
    role: "editor",
    response: TripDetail,
    handle: async ({ actor, params }) =>
      orThrow(
        await runCommand(actor, {
          type: "RemoveDay",
          tripId: params["tripId"]!,
          dayId: params["dayId"]!,
        }),
      ),
  },
});
