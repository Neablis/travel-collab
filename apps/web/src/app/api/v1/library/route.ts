import { z } from "zod";
import { SavedDay } from "@tc/contracts";
import { listSavedDays, saveDay } from "@/server/savedDays";
import { tripAccessFor } from "@/server/access/trip-access";
import { PublicApiError } from "@/server/public-api/commands";
import { route } from "@/server/public-api/route";

// **Your saved-days library** — a clean collection already.
//
// **Not under `/trips/:id`**, because a library belongs to an account and not to
// a trip: days saved from a trip you later leave are still yours. Saving one
// names its source trip in the body instead, which is where the trip check
// happens.
const SaveDayBody = z.object({
  tripId: z.string().uuid(),
  dayId: z.string().uuid(),
  name: z.string().min(1).max(200),
});

export const { GET, POST } = route({
  GET: {
    scope: "library:read",
    collection: { item: SavedDay, cursorOf: (day: z.infer<typeof SavedDay>) => day.createdAt },
    handle: async ({ actor, page }) => {
      const all = await listSavedDays(actor.userId);
      const after = page.after;
      return (after === null ? all : all.filter((d) => d.createdAt < after)).slice(0, page.limit);
    },
  },
  POST: {
    scope: "library:write",
    body: SaveDayBody,
    response: SavedDay,
    handle: async ({ actor, body }) => {
      const input = body as z.infer<typeof SaveDayBody>;
      // **The trip gate runs here, by hand, and that is the honest cost of
      // putting this collection outside `/trips/:id`.** The wrapper checks the
      // trip in the path; this endpoint's trip is in the body, so the same seam
      // is called directly rather than a weaker check being invented.
      if (!(actor.via === "session" || actor.tripIds === null || actor.tripIds.has(input.tripId))) {
        throw new PublicApiError(403, "This token is not scoped to that trip.", "trip-out-of-scope");
      }
      const access = await tripAccessFor(actor.userId, input.tripId, "viewer");
      if (!access.ok) {
        throw new PublicApiError(
          access.denial === "not-found" ? 404 : 403,
          access.denial === "not-found" ? "No such trip." : "You do not have access to this trip.",
        );
      }
      const saved = await saveDay({ name: input.name, dayId: input.dayId }, access.detail, actor.userId);
      if (!saved.ok) throw new PublicApiError(400, saved.error.message);
      return saved.value;
    },
  },
});
