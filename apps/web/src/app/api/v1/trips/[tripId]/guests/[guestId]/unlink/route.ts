import { Guest } from "@tc/contracts";
import { unlinkGuest } from "@/server/access/guests";
import { PublicApiError } from "@/server/public-api/commands";
import { route } from "@/server/public-api/route";

// **Unclaim a guest record.** Owner only — unclaiming someone else's record is
// taking an identity away, a membership operation, not content. The role gate
// says `owner` and the server function (`mayUnlinkGuest`) says it again inside
// the transaction, for the internal caller the gate will never see.
export const { POST } = route({
  POST: {
    summary: "Unclaim a guest record",
    scope: "sharing:write",
    trip: "path",
    role: "owner",
    response: Guest,
    handle: async ({ actor, params }) => {
      const unlinked = await unlinkGuest(params["tripId"]!, params["guestId"]!, actor.userId);
      if (!unlinked.ok) {
        throw new PublicApiError(
          unlinked.error.code === "not-found" ? 404 : unlinked.error.code === "forbidden" ? 403 : 400,
          unlinked.error.message,
        );
      }
      return unlinked.value;
    },
  },
});
