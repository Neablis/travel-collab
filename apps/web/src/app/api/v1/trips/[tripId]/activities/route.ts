import { randomUUID } from "node:crypto";
import { AddActivity, GEOCODE_OUTCOME_HEADER, TripDetail, type Location } from "@tc/contracts";
import { tripRegionOf } from "@/server/geocoding/region";
import { orThrow, runCommand } from "@/server/public-api/commands";
import { GEOCODE_OUTCOME_DOC, resolveStopLocation } from "@/server/public-api/locations";
import { route } from "@/server/public-api/route";

// Adding a stop. The body is `AddActivity` minus the two fields the server owns:
// `type` (this endpoint IS the type) and `activityId` (minted here, for the
// reason `POST /v1/trips` mints its own).
const AddStopBody = AddActivity.omit({ type: true, tripId: true, activityId: true, placeRef: true });

export const { POST } = route({
  POST: {
    summary: "Add a stop to a trip, on a day or in the unscheduled backlog (geocodes its location if needed)",
    scope: "trips:write",
    trip: "path",
    role: "editor",
    body: AddStopBody,
    response: TripDetail,
    responseHeaders: { [GEOCODE_OUTCOME_HEADER]: GEOCODE_OUTCOME_DOC },
    handle: async ({ actor, params, body, trip, responseHeaders }) => {
      const b = body as { location?: Location } & Record<string, unknown>;
      let location = b.location;
      if (location) {
        // ADR-007's pre-command enrichment: the domain only ever stores
        // coordinates it is handed. The header is set even if the command is
        // then refused, because the lookup already happened and was charged —
        // it describes the location, not the write.
        const resolved = await resolveStopLocation(location, {
          userId: actor.userId,
          region: tripRegionOf(trip!),
        });
        location = resolved.location;
        responseHeaders.set(GEOCODE_OUTCOME_HEADER, resolved.outcome);
      }
      return orThrow(
        await runCommand(actor, {
          ...b,
          ...(location ? { location } : {}),
          type: "AddActivity",
          tripId: params["tripId"]!,
          activityId: randomUUID(),
        } as Parameters<typeof runCommand>[1]),
      );
    },
  },
});
