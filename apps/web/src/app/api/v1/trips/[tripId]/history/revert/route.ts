import { z } from "zod";
import { TripDetail } from "@tc/contracts";
import { orThrow, runCommand } from "@/server/public-api/commands";
import { route } from "@/server/public-api/route";

// "Revert to here". Takes the revision in the body rather than the path because
// it is an instruction, not a sub-resource — `POST /history/42` would read as
// creating something at revision 42.
export const { POST } = route({
  POST: {
    summary: "Return a trip to how it stood at a past revision, recorded as a new change",
    scope: "trips:write",
    trip: "path",
    role: "editor",
    status: 200,
    body: z.object({ toSeq: z.number().int().positive() }),
    response: TripDetail,
    handle: async ({ actor, params, body }) =>
      orThrow(
        await runCommand(actor, {
          type: "RevertToState",
          tripId: params["tripId"]!,
          toSeq: (body as { toSeq: number }).toSeq,
        }),
      ),
  },
});
