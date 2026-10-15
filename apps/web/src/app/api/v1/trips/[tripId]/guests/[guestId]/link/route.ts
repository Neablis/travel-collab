import { Guest, LinkGuestInput } from "@tc/contracts";
import type { z } from "zod";
import { linkGuest } from "@/server/access/guests";
import { PublicApiError } from "@/server/public-api/commands";
import { route } from "@/server/public-api/route";

// **Claim a guest record for a member.**
//
// Any member may link for themselves — the "X signs up and claims their guest
// record" flow — which is why the role gate is `viewer`, not `editor`: the
// policy (`mayLinkGuest`) is about identity, not content, and the server
// function enforces it inside the transaction.
export const { POST } = route({
  POST: {
    summary: "Claim a guest record for a trip member",
    scope: "sharing:write",
    trip: "path",
    role: "viewer",
    body: LinkGuestInput,
    response: Guest,
    handle: async ({ actor, params, body }) => {
      const linked = await linkGuest(
        params["tripId"]!,
        params["guestId"]!,
        (body as z.infer<typeof LinkGuestInput>).userId,
        actor.userId,
      );
      if (!linked.ok) {
        throw new PublicApiError(
          linked.error.code === "not-found" ? 404 : linked.error.code === "forbidden" ? 403 : 400,
          linked.error.message,
        );
      }
      return linked.value;
    },
  },
});
