import { TripHistory } from "@tc/contracts";
import { getTripHistory } from "@/server/history";
import { PublicApiError } from "@/server/public-api/commands";
import { route } from "@/server/public-api/route";

// Every change anyone has made to this trip, newest first.
export const { GET } = route({
  GET: {
    scope: "trips:read",
    trip: "path",
    role: "viewer",
    response: TripHistory,
    handle: async ({ params }) => {
      const history = await getTripHistory(params["tripId"]!);
      // Unreachable while the trip resolved above, and asserted rather than
      // assumed: a trip whose detail exists but whose stream does not is a
      // broken invariant, not a 404.
      if (history === null) throw new PublicApiError(500, "This trip's history could not be read.");
      return history;
    },
  },
});
