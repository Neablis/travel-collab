import { TripDetail } from "@tc/contracts";
import { orThrow, runCommand } from "@/server/public-api/commands";
import { route } from "@/server/public-api/route";

export const { POST } = route({
  POST: {
    scope: "trips:write",
    trip: "path",
    role: "editor",
    status: 200,
    response: TripDetail,
    handle: async ({ actor, params }) =>
      orThrow(await runCommand(actor, { type: "RedoChange", tripId: params["tripId"]! })),
  },
});
