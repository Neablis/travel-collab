import { CreateGuestInput, Guest } from "@tc/contracts";
import type { z } from "zod";
import { listGuests, addGuest } from "@/server/access/guests";
import { PublicApiError } from "@/server/public-api/commands";
import { decodeKeyedCursor, keyedCursor, route } from "@/server/public-api/route";

// **The trip's named travellers with no account (guests spec P1).**
//
// A guest is Access data, not planning data: it names who is coming, the way
// the members list does. So reads take `trips:read` (the People panel reads
// guests beside members), and every write takes `sharing:write` — the scope
// for the Access module's "who is on this trip" writes — never `trips:write`,
// which would let a token minted to sync an itinerary rewrite the people list
// (the module-map reasoning that separated `sharing:write` in the first place).
export const { GET, POST } = route({
  GET: {
    summary: "List the trip's named guests (travellers with no account)",
    scope: "trips:read",
    trip: "path",
    role: "viewer",
    collection: {
      item: Guest,
      cursorOf: (guest: z.infer<typeof Guest>) => keyedCursor(guest.createdAt, guest.guestId),
    },
    handle: async ({ params, page }) => {
      const tripId = params["tripId"]!;
      const all = await listGuests(tripId);
      const after = decodeKeyedCursor(page.after);
      if (after === null) return all.slice(0, page.limit);
      return all
        .filter(
          (g) =>
            g.createdAt < after.sortKey ||
            (g.createdAt === after.sortKey && g.guestId < after.id),
        )
        .slice(0, page.limit);
    },
  },
  POST: {
    summary: "Name a guest on a trip",
    scope: "sharing:write",
    trip: "path",
    role: "editor",
    body: CreateGuestInput,
    response: Guest,
    handle: async ({ actor, params, body }) => {
      const added = await addGuest(
        params["tripId"]!,
        (body as z.infer<typeof CreateGuestInput>).name,
        actor.userId,
      );
      // `route()` names the wire code from the status (`codeForStatus`): 404
      // `not-found`, 403 `forbidden`, 400 `invalid-request`.
      if (!added.ok) {
        throw new PublicApiError(
          added.error.code === "not-found" ? 404 : added.error.code === "forbidden" ? 403 : 400,
          added.error.message,
        );
      }
      return added.value;
    },
  },
});
