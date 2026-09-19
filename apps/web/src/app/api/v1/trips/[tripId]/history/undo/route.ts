import { TripDetail } from "@tc/contracts";
import { orThrow, runCommand } from "@/server/public-api/commands";
import { route } from "@/server/public-api/route";

// The second of the three actions REST has no noun for. Undo is decided against
// the LOG rather than against folded state (ADR-005), which is why it is not a
// PATCH of anything.
export const { POST } = route({
  POST: {
    summary: "Undo the most recent change to a trip",
    scope: "trips:write",
    trip: "path",
    role: "editor",
    status: 200,
    response: TripDetail,
    handle: async ({ actor, params }) =>
      orThrow(await runCommand(actor, { type: "UndoLastChange", tripId: params["tripId"]! })),
  },
});
