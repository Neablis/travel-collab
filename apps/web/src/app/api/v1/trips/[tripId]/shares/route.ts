import { TripShare } from "@tc/contracts";
import { createShare, listShares } from "@/server/access/shares";
import { PublicApiError } from "@/server/public-api/commands";
import { route } from "@/server/public-api/route";

// Read-only share links for a trip.
//
// **Reading them is `trips:read`; creating one is `sharing:write`** — and that
// asymmetry is Decision 4's whole point. Listing your own trip's links is not
// more sensitive than reading the trip; handing someone a link is Access &
// Membership, which is a materially different power from "add a day".
export const { GET, POST } = route({
  GET: {
    scope: "trips:read",
    trip: "path",
    role: "owner",
    collection: { item: TripShare, cursorOf: (share: TripShare) => share.createdAt },
    handle: async ({ params, page }) => {
      const all = await listShares(params["tripId"]!);
      const after = page.after;
      return (after === null ? all : all.filter((s) => s.createdAt < after)).slice(0, page.limit);
    },
  },
  POST: {
    scope: "sharing:write",
    trip: "path",
    role: "owner",
    response: TripShare,
    handle: async ({ actor, params }) => {
      const created = await createShare(params["tripId"]!, actor.userId);
      if (!created.ok) throw new PublicApiError(400, created.error.message);
      return created.value;
    },
  },
});
