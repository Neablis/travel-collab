import { randomUUID } from "node:crypto";
import { AddActivity, GEOCODE_OUTCOME_END_HEADER, GEOCODE_OUTCOME_HEADER, TripDetail, type Location } from "@tc/contracts";
import { tripRegionOf } from "@/server/geocoding/region";
import { orThrow, refuseUnparseable, runCommand, type CommandInput } from "@/server/public-api/commands";
import { GEOCODE_OUTCOME_DOC, GEOCODE_OUTCOME_END_DOC, resolveStopPlaces } from "@/server/public-api/locations";
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
    responseHeaders: { [GEOCODE_OUTCOME_HEADER]: GEOCODE_OUTCOME_DOC, [GEOCODE_OUTCOME_END_HEADER]: GEOCODE_OUTCOME_END_DOC },
    handle: async ({ actor, params, body, trip, responseHeaders }) => {
      const command = {
        ...(body as Record<string, unknown>),
        type: "AddActivity",
        tripId: params["tripId"]!,
        activityId: randomUUID(),
      } as CommandInput & { location?: Location; endLocation?: Location };
      // Refused before anything is looked up: a travel leg on a stop that is not
      // transit (M24; `kind` omitted means "planned") is decided by the body
      // alone, and a lookup for it would be charged for a write that cannot land.
      refuseUnparseable([command]);
      // ADR-007's pre-command enrichment: the domain only ever stores
      // coordinates it is handed. The headers are set even if the command is
      // then refused by the domain, because the lookup already happened and was
      // charged — they describe the places, not the write.
      const ctx = { userId: actor.userId, region: tripRegionOf(trip!) };
      return orThrow(await runCommand(actor, await resolveStopPlaces(command, ctx, responseHeaders)));
    },
  },
});
