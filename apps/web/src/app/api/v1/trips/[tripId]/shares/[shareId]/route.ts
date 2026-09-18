import { TripShare } from "@tc/contracts";
import { revokeShare } from "@/server/access/shares";
import { PublicApiError } from "@/server/public-api/commands";
import { route } from "@/server/public-api/route";

export const { DELETE } = route({
  DELETE: {
    scope: "sharing:write",
    trip: "path",
    role: "owner",
    response: TripShare,
    handle: async ({ params }) => {
      const revoked = await revokeShare(params["tripId"]!, params["shareId"]!);
      // Already-revoked answers ok rather than 404 — `revokeShare`'s own rule,
      // so a retry cannot produce a scary error.
      if (!revoked.ok) throw new PublicApiError(404, revoked.error.message, "not-found");
      return revoked.value;
    },
  },
});
