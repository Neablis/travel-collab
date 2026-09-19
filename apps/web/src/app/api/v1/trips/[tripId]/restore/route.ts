import { TripDetail } from "@tc/contracts";
import { orThrow, runCommand } from "@/server/public-api/commands";
import { route } from "@/server/public-api/route";

// **One of the three actions REST has no noun for.** Undeleting is not a
// resource, so it is a verb — and naming it plainly beats inventing
// `PATCH /trips/:id { "status": "active" }`, which would pretend status is a
// field a caller may set.
export const { POST } = route({
  POST: {
    summary: "Bring back a trip you deleted",
    scope: "trips:write",
    trip: "path",
    role: "owner",
    // Creates nothing, so 200 rather than 201 — the one place a declaration
    // says so.
    status: 200,
    response: TripDetail,
    handle: async ({ actor, params }) =>
      orThrow(await runCommand(actor, { type: "RestoreTrip", tripId: params["tripId"]! })),
  },
});
