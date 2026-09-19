import { z } from "zod";
import { SavedDay } from "@tc/contracts";
import { listSavedDays, saveDay } from "@/server/savedDays";
import { tripAccessFor } from "@/server/access/trip-access";
import { PublicApiError } from "@/server/public-api/commands";
import { decodeKeyedCursor, keyedCursor, route } from "@/server/public-api/route";

// **Your saved-days library** — a clean collection already.
//
// **Not under `/trips/:id`**, because a library belongs to an account and not to
// a trip: days saved from a trip you later leave are still yours. Saving one
// names its source trip in the body instead, which is where the trip check
// happens.
//
// **`dayId`, singular, and it STAYS singular through M23.** The library's own
// `CreateSavedDayInput` took a set of days in that milestone so a Playbook can
// span several; this body deliberately did not follow. It is a PUBLISHED v1
// contract with a generated `openapi.json` behind it, M23's scope says nothing
// about the public API, and widening it would either break every existing
// caller or leave two shapes here for one question — the thing
// `CreateSavedDayInput` refused for itself. A one-day keep is still a whole
// operation, so this endpoint keeps doing it and calls the sequence path with a
// one-element list. Multi-day over `v1` is a deliberate gap, not an oversight.
const SaveDayBody = z.object({
  tripId: z.string().uuid(),
  dayId: z.string().uuid(),
  name: z.string().min(1).max(200),
});

export const { GET, POST } = route({
  GET: {
    scope: "library:read",
    collection: {
      item: SavedDay,
      cursorOf: (day: z.infer<typeof SavedDay>) => keyedCursor(day.createdAt, day.savedDayId),
    },
    handle: async ({ actor, page }) => {
      const all = await listSavedDays(actor.userId);
      const after = decodeKeyedCursor(page.after);
      if (after === null) return all.slice(0, page.limit);
      // `listSavedDays` is newest first with `savedDayId` breaking ties, so
      // "after" is strictly lower on that pair.
      return all
        .filter(
          (d) =>
            d.createdAt < after.sortKey ||
            (d.createdAt === after.sortKey && d.savedDayId < after.id),
        )
        .slice(0, page.limit);
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
        // The same three answers `route()`'s own gate gives, because this is the
        // same gate called by hand. `malformed-trip` is a stored document this
        // server could not parse — ours to own as a 500, and telling the caller
        // they lack access to a trip they may well own is both wrong and
        // unfixable from their side.
        const mapped = {
          "not-found": { status: 404, message: "No such trip." },
          forbidden: { status: 403, message: "You do not have access to this trip." },
          "malformed-trip": {
            status: 500,
            message: "This trip could not be read. The failure has been logged.",
          },
        }[access.denial];
        throw new PublicApiError(mapped.status, mapped.message);
      }
      const saved = await saveDay({ name: input.name, dayIds: [input.dayId] }, access.detail, actor.userId);
      if (!saved.ok) throw new PublicApiError(400, saved.error.message);
      return saved.value;
    },
  },
});
