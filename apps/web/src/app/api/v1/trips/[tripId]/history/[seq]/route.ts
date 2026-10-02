import { TripDetail } from "@tc/contracts";
import { overlayMembers } from "@/server/access/overlay";
import { getTripDetailAt } from "@/server/history";
import { PublicApiError } from "@/server/public-api/commands";
import { route } from "@/server/public-api/route";

// The trip as it stood at one point in its history — the read behind "revert to
// here", and useful on its own to anything that wants to diff two moments.
export const { GET } = route({
  GET: {
    summary: "Get a trip as it stood at a past revision, without changing it",
    scope: "trips:read",
    trip: "path",
    role: "viewer",
    response: TripDetail,
    handle: async ({ params, trip }) => {
      const seq = Number(params["seq"]);
      if (!Number.isInteger(seq) || seq < 1) {
        throw new PublicApiError(400, "A revision is a positive whole number.");
      }
      const at = await getTripDetailAt(params["tripId"]!, seq);
      if (at === null) throw new PublicApiError(404, "This trip has no such revision.");
      // The replay is of the PLAN, not of who is on the trip — membership has no
      // seq to replay to (ADR-026) — so it gets today's members, and the totals
      // they imply (ADR-060), exactly as the app's own history route does.
      // `trip` is the overlaid detail `trip: "path"` already loaded.
      return overlayMembers(at, trip!.members);
    },
  },
});
