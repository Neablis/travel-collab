import { Guest, UpdateGuestInput } from "@tc/contracts";
import type { z } from "zod";
import { removeGuest, updateGuest } from "@/server/access/guests";
import { PublicApiError } from "@/server/public-api/commands";
import { route } from "@/server/public-api/route";

// **A guest, renamed or retoggled, or removed.**
//
// DELETE answers 200 with the removed guest, not a 204: `route()` builds every
// answer with `Response.json`, which cannot carry a 204, and the deleted
// resource is the useful thing (the trip delete and the share/invite revokes
// answer the same way — see `surface.int.test.ts`'s note).
export const { PATCH, DELETE } = route({
  PATCH: {
    summary: "Rename a guest, or change whether they are travelling",
    scope: "sharing:write",
    trip: "path",
    role: "editor",
    body: UpdateGuestInput,
    response: Guest,
    handle: async ({ actor, params, body }) => {
      const updated = await updateGuest(
        params["tripId"]!,
        params["guestId"]!,
        body as z.infer<typeof UpdateGuestInput>,
        actor.userId,
      );
      if (!updated.ok) {
        throw new PublicApiError(
          updated.error.code === "not-found" ? 404 : updated.error.code === "forbidden" ? 403 : 400,
          updated.error.message,
        );
      }
      return updated.value;
    },
  },
  DELETE: {
    summary: "Remove a guest from a trip",
    scope: "sharing:write",
    trip: "path",
    role: "editor",
    response: Guest,
    handle: async ({ actor, params }) => {
      const removed = await removeGuest(params["tripId"]!, params["guestId"]!, actor.userId);
      if (!removed.ok) {
        throw new PublicApiError(
          removed.error.code === "not-found" ? 404 : removed.error.code === "forbidden" ? 403 : 400,
          removed.error.message,
        );
      }
      return removed.value;
    },
  },
});
