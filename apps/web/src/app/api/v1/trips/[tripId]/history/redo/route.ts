import { TripDetail } from "@tc/contracts";
import { orThrow, runCommand } from "@/server/public-api/commands";
import { route } from "@/server/public-api/route";
import { requireCurrentTrip } from "@/server/public-api/current";

export const { POST } = route({
  POST: {
    summary: "Redo the change most recently undone on a trip",
    scope: "trips:write",
    orScope: "current:write",
    trip: "path",
    role: "editor",
    status: 200,
    response: TripDetail,
    handle: async ({ actor, params, trip }) => {
      requireCurrentTrip(actor, trip!, "trips:write", "current:write", Date.now());
      return orThrow(await runCommand(actor, { type: "RedoChange", tripId: params["tripId"]! }));
    },
  },
});
