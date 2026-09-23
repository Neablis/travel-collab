import { z } from "zod";
import { SavedDay } from "@tc/contracts";
import { keepDays, savedDayCollection } from "@/server/public-api/library";
import { route } from "@/server/public-api/route";

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
// one-element list. Multi-day over `v1` is `/v1/playbooks` (ADR-050), a second
// view over the same rows; both declare through `server/public-api/library.ts`.
const SaveDayBody = z.object({
  tripId: z.string().uuid(),
  dayId: z.string().uuid(),
  name: z.string().min(1).max(200),
});

export const { GET, POST } = route({
  GET: savedDayCollection("List the days you have saved to your library, newest first"),
  POST: {
    summary: "Save one day of a trip you can see into your library",
    scope: "library:write",
    body: SaveDayBody,
    response: SavedDay,
    handle: ({ actor, body }) => {
      const input = body as z.infer<typeof SaveDayBody>;
      return keepDays(actor, { tripId: input.tripId, name: input.name, dayIds: [input.dayId] });
    },
  },
});
