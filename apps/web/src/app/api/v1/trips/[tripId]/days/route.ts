import { randomUUID } from "node:crypto";
import { TripDetail } from "@tc/contracts";
import { orThrow, runCommand } from "@/server/public-api/commands";
import { route } from "@/server/public-api/route";
import { requireCurrentTrip } from "@/server/public-api/current";

// `AddDay`. The whole mapping is three lines, and the id is the server's to mint
// for the reason `POST /v1/trips` mints its own.
export const { POST } = route({
  POST: {
    summary: "Add an empty day to the end of a trip",
    scope: "trips:write",
    orScope: "current:write",
    trip: "path",
    role: "editor",
    response: TripDetail,
    handle: async ({ actor, params, trip }) => {
      requireCurrentTrip(actor, trip!, "trips:write", "current:write", Date.now());
      return orThrow(
        await runCommand(actor, { type: "AddDay", tripId: params["tripId"]!, dayId: randomUUID() }),
      );
    },
  },
});
