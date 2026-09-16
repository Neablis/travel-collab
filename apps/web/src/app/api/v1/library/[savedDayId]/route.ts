import { z } from "zod";
import { SavedDay, SavedDayVisibility } from "@tc/contracts";
import { deleteSavedDay, getSavedDay, setSavedDayVisibility } from "@/server/savedDays";
import { PublicApiError } from "@/server/public-api/commands";
import { route } from "@/server/public-api/route";

// One saved day: read it, publish or unpublish it, delete it.
//
// **Publishing is a `PATCH` of a two-state field, not two verbs.** *"A patch is
// a patch"* — the API does not need `/publish` and `/unpublish` endpoints to
// express one boolean, and inventing them would leak how the UI happens to
// present it.
export const { GET, PATCH, DELETE } = route({
  GET: {
    scope: "library:read",
    response: SavedDay,
    handle: async ({ actor, params }) => {
      const day = await getSavedDay(params["savedDayId"]!, actor.userId);
      if (day === null) throw new PublicApiError(404, "No such saved day of yours.");
      return day;
    },
  },
  PATCH: {
    scope: "library:write",
    body: z.object({ visibility: SavedDayVisibility }),
    response: SavedDay,
    handle: async ({ actor, params, body }) => {
      const updated = await setSavedDayVisibility(
        params["savedDayId"]!,
        actor.userId,
        (body as { visibility: z.infer<typeof SavedDayVisibility> }).visibility,
      );
      if (updated === null) throw new PublicApiError(404, "No such saved day of yours.");
      return updated;
    },
  },
  DELETE: {
    scope: "library:write",
    response: z.object({ savedDayId: z.string(), deleted: z.literal(true) }),
    handle: async ({ actor, params }) => {
      const outcome = await deleteSavedDay(params["savedDayId"]!, actor.userId);
      if (outcome === "not-found") throw new PublicApiError(404, "No such saved day of yours.");
      if (outcome === "published") {
        // It exists and you own it; it is published, so unpublish it first.
        // 409, because the caller can fix this and the fix is one PATCH away.
        throw new PublicApiError(
          409,
          "This day is published. Unpublish it before deleting it.",
          "invalid-request",
        );
      }
      return { savedDayId: params["savedDayId"]!, deleted: true as const };
    },
  },
});
