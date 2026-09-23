import { z } from "zod";
import { insertSavedDay } from "@/server/savedDays";
import { orThrow, PublicApiError, refusal } from "@/server/public-api/commands";
import { route } from "@/server/public-api/route";

// **Apply a Playbook to a trip** (ADR-050): its days appended at the end, every
// stop on the day it belongs to — `insertSavedDay`, the one construction the
// app's own "Add to a trip" calls, over v1.
//
// **A noun because REST wants one.** Applying creates days and stops; the
// application is the record of that, and `POST` of one is the create. There is
// nothing to `GET` back — the result is the trip, which already has its own URL.
//
// **One batch, so one history entry and one undo**, and ids minted fresh per
// application so the same Playbook can go into one trip twice. Nothing about
// the source trip — its dates, its ids — comes across; a `SavedStop` never
// carried either.

const Application = z.object({
  tripId: z.string().uuid(),
  playbookId: z.string().uuid(),
  dayIds: z
    .array(z.string().uuid())
    .describe("The new days' ids, in the Playbook's day order — one per day, empty days included."),
  activityIds: z
    .array(z.string().uuid())
    .describe("The new stops' ids, in the same order as the Playbook's `stops`."),
  historySeq: z
    .number()
    .int()
    .positive()
    .describe(
      "The revision the trip stands at after this application (its history entry's `toSeq`). " +
        "The whole application is that one entry, so one undo removes all of it.",
    ),
});

export const { POST } = route({
  POST: {
    summary: "Append a Playbook's days and stops to the end of a trip, as one undoable change",
    scope: "trips:write",
    trip: "path",
    role: "editor",
    body: z.object({ playbookId: z.string().uuid() }),
    response: Application,
    handle: async ({ actor, params, body }) => {
      const tripId = params["tripId"]!;
      const { playbookId } = body as { playbookId: string };
      const result = await insertSavedDay(playbookId, tripId, actor.userId);
      if (!result.ok) {
        // Someone else's private Playbook reads as missing, exactly like one
        // that does not exist — `readableSavedDay` decides, and a 403 here
        // would confirm the id. Every other refusal is the command pipeline's.
        if (result.error.code === "not-found") throw new PublicApiError(404, "No such playbook.");
        // `refusal` never answers ok, so this always throws.
        return orThrow(refusal(result.error));
      }
      // Newest first, and this batch was the last append.
      const entry = result.history.entries[0];
      if (entry === undefined) throw new Error("an accepted batch left no history entry");
      return {
        tripId,
        playbookId,
        dayIds: result.minted.dayIds,
        activityIds: result.minted.activityIds,
        historySeq: entry.toSeq,
      };
    },
  },
});
