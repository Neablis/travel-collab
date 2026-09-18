import { randomUUID } from "node:crypto";
import { AddActivity, TripDetail } from "@tc/contracts";
import { orThrow, runCommand } from "@/server/public-api/commands";
import { route } from "@/server/public-api/route";

// Adding a stop. The body is `AddActivity` minus the two fields the server owns:
// `type` (this endpoint IS the type) and `activityId` (minted here, for the
// reason `POST /v1/trips` mints its own).
const AddStopBody = AddActivity.omit({ type: true, tripId: true, activityId: true, placeRef: true });

export const { POST } = route({
  POST: {
    scope: "trips:write",
    trip: "path",
    role: "editor",
    body: AddStopBody,
    response: TripDetail,
    handle: async ({ actor, params, body }) =>
      orThrow(
        await runCommand(actor, {
          ...(body as Record<string, unknown>),
          type: "AddActivity",
          tripId: params["tripId"]!,
          activityId: randomUUID(),
        } as Parameters<typeof runCommand>[1]),
      ),
  },
});
