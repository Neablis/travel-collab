import { TripInvite } from "@tc/contracts";
import { revokeInvite } from "@/server/access/invites";
import { PublicApiError } from "@/server/public-api/commands";
import { route } from "@/server/public-api/route";

export const { DELETE } = route({
  DELETE: {
    summary: "Revoke an invite to a trip",
    scope: "sharing:write",
    trip: "path",
    role: "owner",
    response: TripInvite,
    handle: async ({ params }) => {
      const revoked = await revokeInvite(params["tripId"]!, params["inviteId"]!);
      if (!revoked.ok) throw new PublicApiError(404, revoked.error.message, "not-found");
      return revoked.value;
    },
  },
});
