import { z } from "zod";
import { GEOCODE_OUTCOME_HEADER, TripDetail, UpdateActivity, type Location } from "@tc/contracts";
import { tripRegionOf } from "@/server/geocoding/region";
import { orThrow, runBatch, runCommand, type CommandInput } from "@/server/public-api/commands";
import { GEOCODE_OUTCOME_DOC, resolveStopLocation } from "@/server/public-api/locations";
import { route } from "@/server/public-api/route";

// **The endpoint Decision 14 is about.**
//
// Mitchell, 2026-09-16: *"Follow rest, you dont need to make opinions about
// whats actually happening a patch is a patch."* An activity is a resource with
// fields; whether the fields sent are `title` and `cost`, or `dayId` and
// `position`, or all four, is not the API's business.
//
// That `UpdateActivity` and `MoveActivity` are two commands internally is OUR
// implementation detail, and this is the same principle that kept the command
// envelope unpublished: the public surface does not leak our vocabulary.
//
// **A patch touching both halves composes one batch**, which is already
// all-or-nothing — so "these land together or not at all" costs nothing to
// promise.
const PatchStopBody = UpdateActivity.omit({ type: true, tripId: true, activityId: true, placeRef: true })
  .extend({
    // The move half, in the same flat object. `dayId: null` is the backlog.
    dayId: z.string().uuid().nullable().optional(),
    position: z.number().int().nonnegative().optional(),
  })
  .strict();

export const { PATCH, DELETE } = route({
  PATCH: {
    summary: "Edit a stop's details, or move it to another day, position or the backlog",
    scope: "trips:write",
    trip: "path",
    role: "editor",
    body: PatchStopBody,
    response: TripDetail,
    responseHeaders: { [GEOCODE_OUTCOME_HEADER]: GEOCODE_OUTCOME_DOC },
    handle: async ({ actor, params, body, trip, responseHeaders }) => {
      const { dayId, position, ...fields } = body as {
        dayId?: string | null;
        position?: number;
      } & Record<string, unknown>;
      const tripId = params["tripId"]!;
      const activityId = params["activityId"]!;
      // Only a location the caller actually sent is resolved. `location: null`
      // clears the stop's pin and an absent one leaves it alone; neither is a
      // place to look up, so neither spends a geocode.
      if (typeof fields["location"] === "object" && fields["location"] !== null) {
        const resolved = await resolveStopLocation(fields["location"] as Location, {
          userId: actor.userId,
          region: tripRegionOf(trip!),
        });
        fields["location"] = resolved.location;
        responseHeaders.set(GEOCODE_OUTCOME_HEADER, resolved.outcome);
      }
      const commands: CommandInput[] = [];
      if (Object.keys(fields).length > 0) {
        commands.push({ ...fields, type: "UpdateActivity", tripId, activityId } as CommandInput);
      }
      if (dayId !== undefined || position !== undefined) {
        // **An omitted `dayId` is not the backlog.** `MoveActivity` names both
        // halves, so a `PATCH { position }` has to supply a day — and `?? null`
        // supplied the backlog, quietly pulling a stop off the day it was on
        // when all the caller asked for was a reorder. `null` still MEANS the
        // backlog; it just has to be asked for.
        const currentDayId = trip!.days.find((d) => d.activityIds.includes(activityId))?.dayId ?? null;
        commands.push({
          type: "MoveActivity",
          tripId,
          activityId,
          // A move names both halves; a patch may name one. `position: 0`
          // appends to the front, which is the only sensible default for "put
          // it on this day" with no position given.
          toDayId: dayId === undefined ? currentDayId : dayId,
          position: position ?? 0,
        });
      }
      return orThrow(await runBatch(actor, commands));
    },
  },
  DELETE: {
    summary: "Remove a stop from a trip",
    scope: "trips:write",
    trip: "path",
    role: "editor",
    response: TripDetail,
    handle: async ({ actor, params }) =>
      orThrow(
        await runCommand(actor, {
          type: "RemoveActivity",
          tripId: params["tripId"]!,
          activityId: params["activityId"]!,
        }),
      ),
  },
});
