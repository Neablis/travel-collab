import { CreateInviteInput, TripInvite } from "@tc/contracts";
import { createInvite, listInvites } from "@/server/access/invites";
import { decodeKeyedCursor, keyedCursor, route } from "@/server/public-api/route";
import type { z } from "zod";

// **`sharing:write`, and this is the scope the design nearly missed.**
//
// The first draft had seven scopes, and under it creating an invite fell under
// `trips:write` — because an invite is an ordinary table write against a trip.
// Writing the scope list out in plain language is what exposed it: *"let another
// person into my trip"* is Access & Membership, not Trip Planning. A token
// minted to sync an itinerary from a calendar should not be able to hand a
// stranger editor rights, and under seven scopes it silently could.
export const { GET, POST } = route({
  GET: {
    scope: "trips:read",
    trip: "path",
    role: "owner",
    collection: {
      item: TripInvite,
      cursorOf: (invite: TripInvite) => keyedCursor(invite.createdAt, invite.inviteId),
    },
    handle: async ({ params, page }) => {
      const all = await listInvites(params["tripId"]!);
      const after = decodeKeyedCursor(page.after);
      if (after === null) return all.slice(0, page.limit);
      return all
        .filter(
          (i) =>
            i.createdAt < after.sortKey ||
            (i.createdAt === after.sortKey && i.inviteId < after.id),
        )
        .slice(0, page.limit);
    },
  },
  POST: {
    scope: "sharing:write",
    trip: "path",
    role: "owner",
    body: CreateInviteInput,
    response: TripInvite,
    handle: ({ actor, params, body }) =>
      createInvite(params["tripId"]!, actor.userId, body as z.infer<typeof CreateInviteInput>),
  },
});
